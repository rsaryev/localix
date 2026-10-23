import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { childEnv } from '../../lib/login-shell-env'
import { isPathWithin } from '../../lib/path-containment'
import { whichBinary } from '../agent-core/tools/environments/shell'
import { resolveJsEntry } from './lsp-js-entry'

/**
 * Spawn an LSP server process safely.
 * `spawn` can throw synchronously and, more commonly, emit an async 'error'
 * event (missing/non-executable binary). Without a listener that 'error' is
 * re-thrown as an uncaught exception and crashes the host process. We attach a
 * one-time no-op listener immediately so a failed spawn is contained until the
 * client wires up its own handler. Returns undefined if spawn throws outright.
 */
export function spawnServer(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): ChildProcessWithoutNullStreams | undefined {
  // Windows `node_modules/.bin` shims are `.cmd`/`.bat` batch files; Node refuses
  // to spawn those directly (EINVAL since the 2024 security fix) — they need a
  // shell. Bare executables (.exe) and Unix scripts spawn directly as before.
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Plugin-configured servers may declare extra env (e.g. a language runtime path).
      // childEnv(), not raw process.env: a GUI (Finder/Dock) launch hands the
      // process a bare launchd env with no PATH, and Bun only gives a spawned
      // child the repaired env if it's passed explicitly (see login-shell-env.ts).
      // Without this the server binary (found via `which()`'s own childEnv() call)
      // spawns into an environment where IT can't resolve its own PATH-dependent
      // tools, so it never answers `initialize` and every caller stalls on the
      // 30s INITIALIZE_TIMEOUT_MS in lsp-client.ts.
      env: childEnv(extraEnv),
      shell: needsShell,
      // Own a Unix process group so shutdown can reach language-server children
      // such as vtsls → tsserver instead of orphaning multi-gigabyte descendants.
      detached: process.platform !== 'win32',
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } catch {
    return undefined
  }
  proc.once('error', () => {
    /* contained here; also surfaced to the client's own listener */
  })
  return proc
}

/** PATHEXT-style suffixes probed when resolving a binary by name on Windows. */
const BIN_EXTS = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat', '.ps1'] : ['']

/** Return the first `base+ext` that exists, probing Windows executable suffixes. */
function resolveBinPath(base: string): string | undefined {
  for (const ext of BIN_EXTS) {
    if (fileExists(base + ext)) return base + ext
  }
  return undefined
}

/**
 * Locate an executable on PATH, cross-platform: the server's one lookup (`whichBinary`, which
 * searches the login-shell-repaired PATH the server will be spawned with), memoized.
 */
export function which(cmd: string): string | undefined {
  return whichCache.get(cmd)
}

/**
 * How long a MISS is remembered. A miss is the answer that repeats: `lsp-manager` DELETES a client
 * entry whose `spawn` produced no handle, so the next open of that language resolves
 * again — a full PATH walk (every directory stat'ed, per Windows suffix) on every open of a
 * file whose server is not installed.
 *
 * Bounded rather than permanent so installing a language server mid-session starts
 * working on its own, within a minute, instead of needing a restart.
 */
const NEGATIVE_TTL_MS = 60_000

/**
 * Memoize a PATH lookup. HITS are kept for the life of the process — `childEnv()` is
 * built from the login-shell environment captured at startup, so the PATH this searches
 * does not change under us, and a resolved absolute path stays resolved. MISSES expire.
 *
 * Exported for its own tests: the interesting behaviour is expiry, and a test that has
 * to wait a real minute to see it is a test nobody runs.
 */
export function createMemoizedLookup(
  lookup: (cmd: string) => string | undefined,
  opts: { negativeTtlMs?: number; now?: () => number } = {},
): { get(cmd: string): string | undefined } {
  const negativeTtlMs = opts.negativeTtlMs ?? NEGATIVE_TTL_MS
  const now = opts.now ?? Date.now
  const hits = new Map<string, string>()
  const misses = new Map<string, number>()
  return {
    get(cmd) {
      const hit = hits.get(cmd)
      if (hit !== undefined) return hit
      const missedAt = misses.get(cmd)
      if (missedAt !== undefined && now() - missedAt < negativeTtlMs) return undefined
      const resolved = lookup(cmd)
      if (resolved === undefined) misses.set(cmd, now())
      else {
        hits.set(cmd, resolved)
        misses.delete(cmd)
      }
      return resolved
    },
  }
}

const whichCache = createMemoizedLookup((cmd) => whichBinary(cmd))

export function fileExists(p: string): boolean {
  try {
    fs.statSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * Spawn a JS-based (npm) language server with the runtime already executing the
 * API (`process.execPath` — Bun in our case), NOT via the script's
 * `#!/usr/bin/env node` shebang. This removes the Node.js dependency entirely:
 * Bun runs the server's JS directly through its Node compatibility, so the
 * bundled servers (vtsls for TS, vscode-json/css) work out of the box with no
 * separate Node install (packaged app / Bun-only host). The `.bin` entry is a
 * symlink to the real JS on POSIX and a shim on Windows — {@link resolveJsEntry}
 * recovers the script either way so the runtime executes it itself.
 * (`process.execPath` is whatever runs us, so under a Node host this still works.)
 */
export function spawnJsServer(
  binPath: string,
  args: string[],
  cwd: string,
): ChildProcessWithoutNullStreams | undefined {
  const script = resolveJsEntry(binPath)
  // No JS entry recoverable: run the shim itself, which needs whatever runtime it names
  // but at least does not feed a batch file to a JS parser.
  return script
    ? spawnServer(process.execPath, [script, ...args], cwd)
    : spawnServer(binPath, args, cwd)
}

export function findUpward(
  startDir: string,
  stopDir: string,
  targets: string[],
): string | undefined {
  let dir = startDir
  while (true) {
    for (const t of targets) {
      if (fileExists(path.join(dir, t))) return dir
    }
    if (dir === stopDir || dir === path.dirname(dir)) break
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * Language servers the API installation ships in its own `node_modules`. An opened repository may
 * not replace these: its `node_modules/.bin` is repository code, and the resolved entry runs with
 * the API's runtime as soon as a matching file is opened.
 */
const BUNDLED_NPM_BINS: ReadonlySet<string> = new Set([
  'vtsls',
  'vscode-json-language-server',
  'vscode-css-language-server',
  'docker-langserver',
  'yaml-language-server',
])

/** First `node_modules/.bin/<bin>` from `startDir` upward, stopping after `stopDir` when given. */
function findNpmBinUpward(bin: string, startDir: string, stopDir?: string): string | undefined {
  let dir = startDir
  while (true) {
    const candidate = resolveBinPath(path.join(dir, 'node_modules', '.bin', bin))
    if (candidate) return candidate
    const parent = path.dirname(dir)
    if (dir === stopDir || parent === dir) return undefined
    dir = parent
  }
}

/**
 * Resolve an npm language server, then fall back to `PATH`. A server Localix bundles comes from
 * the installation first and from the project only when the installation lacks it; any other
 * server comes from the project first. Project lookup walks from `rootDir` up to `projectRoot` and
 * never above it (only `rootDir` itself when it lies outside the project). `installDir` is the
 * installation's own location, injectable for tests.
 */
export function resolveNpmBin(
  bin: string,
  rootDir: string,
  projectRoot: string = rootDir,
  installDir: string = import.meta.dir,
): string | undefined {
  const bundled = BUNDLED_NPM_BINS.has(bin)
  const own = bundled ? findNpmBinUpward(bin, installDir) : undefined
  if (own) return own
  const inside = isPathWithin(projectRoot, rootDir)
  const fromProject = findNpmBinUpward(bin, rootDir, inside ? projectRoot : rootDir)
  if (fromProject) return fromProject
  return (bundled ? undefined : findNpmBinUpward(bin, installDir)) ?? which(bin)
}

export function resolveUpward(relativePath: string, startDir: string): string | undefined {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, relativePath)
    if (fileExists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
