import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'

import { withoutAppImageEnv } from './appimage-env'
import { probeShellEnv, probeShellEnvSync } from './login-shell-probe'
import { CACHE_VERSION, readSnapshot, setSnapshotFile, writeSnapshot } from './login-shell-snapshot'

/**
 * GUI-launch environment repair — the single, centralized, stack-agnostic primitive.
 *
 * When Localix is started from a terminal (`bun dev`) the process inherits the
 * shell's fully-resolved environment — PATH plus every version manager's vars
 * (`NVM_DIR`, `PYENV_ROOT`, `RBENV_ROOT`, `CARGO_HOME`, `GOPATH`, `JAVA_HOME`,
 * `BUN_INSTALL`, `SDKMAN_DIR`, …) — so child processes (`git`, `node`, `python`,
 * `cargo`, language servers, MCP `npx` servers, the agent's `bash`) find their
 * tools regardless of stack. But launched from the macOS Finder/Dock (the desktop
 * app) or a Linux `.desktop` entry, the GUI session hands the process the bare
 * launchd/systemd env (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, no `SHELL`), so every
 * child fails with "command not found". Solved here directly rather than with a
 * dependency.
 *
 * TWO facts drive the design (both verified under our Bun runtime):
 *  1. We must capture the WHOLE shell env, not just PATH, and from an
 *     INTERACTIVE login shell (`-ilc`) — version managers initialize in the
 *     interactive rc (`.zshrc`/`.bashrc`), which a login-only shell never sources.
 *     `env -0` dumps it NUL-delimited (no quoting/parsing traps, any stack).
 *  2. Bun (and Node under Bun) hand a spawned child the environment snapshot
 *     taken at PROCESS START unless you pass `env` EXPLICITLY — later
 *     `process.env` mutations are invisible to a no-`env` spawn. So the repaired
 *     env has to be PASSED to each spawn (via `childEnv()`), not just merged into
 *     the ambient `process.env`. See the Bun docs' `env: { ...process.env }`.
 *
 * Lives in the neutral `lib/` layer (alongside `errors`/`cron`) and is fully
 * agnostic — no session/provider/plugin concepts, only Node/Bun built-ins.
 */

const USABLE_SHELL = (s: string | undefined | null): s is string =>
  Boolean(s) && s !== 'unknown' && !s!.endsWith('/false') && !s!.endsWith('/nologin')

/**
 * Resolve the user's login shell WITHOUT trusting `process.env.SHELL` (empty on a
 * GUI launch). `os.userInfo().shell` reads the passwd entry (getpwuid) — robust on
 * macOS+Linux, no `dscl`/`getent` spawn. `$SHELL` is only a fast path for terminal
 * launches; platform default last.
 */
function resolveUserShell(): string | undefined {
  const fromEnv = process.env.SHELL
  if (USABLE_SHELL(fromEnv)) return fromEnv
  if (process.platform === 'win32') return undefined
  try {
    const shell = userInfo().shell
    if (USABLE_SHELL(shell)) return shell
  } catch {
    /* fall through to the platform default */
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/**
 * The env the probe shell starts from. Without the AppImage runtime's library paths: the
 * user's zsh would otherwise load the bundle's libraries before it read a single rc file.
 */
const probeBaseEnv = (): NodeJS.ProcessEnv => withoutAppImageEnv({ ...process.env })

/**
 * Keep only what the SHELL contributed — every key it added or changed relative to
 * the environment we handed it. A spawned shell inherits our `process.env`, so any
 * key that comes back byte-identical carries no information: it is already in
 * `process.env` and re-applying it is a no-op.
 *
 * This is what makes the snapshot safe to persist (below). Session-scoped values
 * (`SSH_AUTH_SOCK`, macOS per-boot `TMPDIR`, `XPC_SERVICE_NAME`, …) pass through the
 * shell unchanged, so the delta drops them and a later run keeps using the LIVE ones
 * from `process.env` instead of a frozen copy — no OS-specific denylist required.
 */
function shellDelta(probed: Record<string, string>): Record<string, string> | undefined {
  const delta: Record<string, string> = {}
  for (const [k, v] of Object.entries(probed)) {
    if (process.env[k] !== v) delta[k] = v
  }
  return Object.keys(delta).length ? delta : undefined
}

/**
 * Files whose contents decide the resolved environment, so a change to any of them
 * must invalidate the cached snapshot. Selected by SHELL FAMILY (basename), never by
 * platform — the same zsh gets the same list on macOS, Linux or a BSD. Absent paths
 * are fingerprinted as missing, so *creating* one invalidates too.
 */
function rcCandidates(shell: string): string[] {
  const home = homedir()
  const base = shell.slice(shell.lastIndexOf('/') + 1)
  const perShell = base.includes('zsh')
    ? ['.zshenv', '.zprofile', '.zshrc', '.zlogin']
    : base.includes('fish')
      ? ['.config/fish/config.fish']
      : base.includes('bash')
        ? ['.bash_profile', '.bash_login', '.bashrc']
        : []
  return [
    ...perShell.map((name) => join(home, name)),
    join(home, '.profile'),
    // System-wide equivalents. `/etc/paths` is where a macOS path_helper install
    // registers itself; on other systems it simply never exists (a missing file is
    // a valid fingerprint entry), so this stays a file probe, not a platform branch.
    '/etc/profile',
    '/etc/zshrc',
    '/etc/bashrc',
    '/etc/paths',
  ]
}

/**
 * Identity of everything the snapshot depends on: the cache format, the resolved
 * shell, the PATH we started from (catches a changed launchd/systemd session), and
 * the size+mtime of every rc file. Any drift and we re-probe.
 */
function fingerprint(shell: string): string {
  const parts = [`v${CACHE_VERSION}`, shell, `PATH=${process.env.PATH ?? ''}`]
  for (const file of rcCandidates(shell)) {
    try {
      const stat = statSync(file)
      parts.push(`${file}:${stat.mtimeMs}:${stat.size}`)
    } catch {
      parts.push(`${file}:-`)
    }
  }
  return parts.join('|')
}

/**
 * The user's login-shell environment, as the DELTA the shell contributes. Memoized AND
 * persisted, because the probe is the most expensive step of API boot (~330 ms for a real
 * `.zshrc`, seconds with nvm/oh-my-zsh); only a cache miss (fresh install, an rc edit)
 * probes at all. `undefined` = not yet resolved, `null` = resolved to nothing.
 */
let cachedEnv: Record<string, string> | null | undefined
let applied = false
/** The in-flight non-blocking probe started by {@link loadLoginShellEnv}. */
let loading: Promise<void> | undefined
/**
 * How it was resolved, for `startup.env_ready`: a snapshot (`hit`), a probe (`miss`), or no
 * usable shell at all (`none`). Without it a slow boot could not say whether it paid a probe.
 */
let resolvedBy: 'hit' | 'miss' | 'none' | undefined
export const loginShellEnvSource = (): 'hit' | 'miss' | 'none' | undefined => resolvedBy

type Plan = { settled: true } | { settled: false; shell: string; key: string }

/** Answer from memory or disk when possible; otherwise say what to probe. */
function planResolution(): Plan {
  if (cachedEnv !== undefined) return { settled: true }
  const shell = resolveUserShell()
  if (!shell) {
    cachedEnv = null
    resolvedBy = 'none'
    return { settled: true }
  }
  const key = createHash('sha256').update(fingerprint(shell)).digest('hex').slice(0, 16)
  const fromDisk = readSnapshot(key)
  if (fromDisk !== undefined) {
    cachedEnv = fromDisk
    resolvedBy = 'hit'
    return { settled: true }
  }
  return { settled: false, shell, key }
}

/** Record a probe's outcome, unless a racing caller already settled it. */
function settle(key: string, probed: Record<string, string> | undefined): void {
  if (cachedEnv !== undefined) return
  resolvedBy = 'miss'
  if (!probed) {
    writeSnapshot({ key, failedAt: Date.now() })
    cachedEnv = null
    return
  }
  const delta = shellDelta(probed) ?? {}
  writeSnapshot({ key, vars: delta })
  cachedEnv = Object.keys(delta).length ? delta : null
}

/**
 * Synchronous resolution, for a caller that must spawn NOW. While the boot probe is still
 * running this blocks on a probe of its own rather than hand the child a half-repaired env:
 * a PATH lookup made with the bare GUI PATH is cached for the process's life
 * (`whichBinary`, the LSP `which` memo), so a wrong early answer does not heal.
 */
function resolveLoginEnv(): Record<string, string> | undefined {
  const plan = planResolution()
  if (!plan.settled) settle(plan.key, probeShellEnvSync(plan.shell, probeBaseEnv()))
  return cachedEnv ?? undefined
}

/**
 * Resolve the login env WITHOUT blocking the event loop, then fold it into `process.env`
 * (see {@link ensureLoginShellEnv}). The boot path: it runs after the socket is bound, and
 * the subsystems that spread `process.env` into their own spawns start only once it
 * settles (`bootstrap.ts` `startPostListen`). A snapshot hit settles on the same turn.
 */
export function loadLoginShellEnv(): Promise<void> {
  if (loading) return loading
  const plan = planResolution()
  loading = plan.settled
    ? Promise.resolve()
    : probeShellEnv(plan.shell, probeBaseEnv()).then((probed) => settle(plan.key, probed))
  loading = loading.then(() => ensureLoginShellEnv())
  return loading
}

/** Test seam: point the snapshot at a scratch file and forget what we resolved. */
export function __resetLoginShellEnvCache(file?: string): void {
  setSnapshotFile(file)
  cachedEnv = undefined
  resolvedBy = undefined
  applied = false
  loading = undefined
}

/**
 * THE canonical child-process env. Pass this as `env` to EVERY spawn/exec so the
 * child gets the user's real shell environment (repaired under a GUI launch),
 * regardless of the process-start snapshot. `overrides` win last.
 *
 * Merge order (low→high): process.env (carries app-set vars like
 * PORT/HOST/LOCALIX_*) → login env (authoritative for PATH + every stack's vars,
 * so it WINS over the bare GUI values) → caller `overrides`.
 *
 * `pathPrefix` (applied LAST) is PREPENDED to the resolved PATH — the seam for
 * putting extra executable dirs ahead of everything (e.g. an enabled plugin's
 * `bin/`). It composes with the login PATH rather than replacing it (an
 * `overrides.PATH` would clobber). Fully agnostic — just "these dirs go first".
 *
 * Under an AppImage the result is stripped of what the AppImage runtime injected for the
 * BUNDLED libraries (`lib/appimage-env.ts`) — last, so no source can put it back.
 */
export function childEnv(overrides?: NodeJS.ProcessEnv, pathPrefix?: string[]): NodeJS.ProcessEnv {
  const login = resolveLoginEnv()
  const merged: NodeJS.ProcessEnv = login
    ? { ...process.env, ...login, ...overrides }
    : { ...process.env, ...overrides }
  if (pathPrefix?.length) {
    merged.PATH = [...pathPrefix, merged.PATH].filter(Boolean).join(delimiter)
  }
  return withoutAppImageEnv(merged)
}

/**
 * `childEnv` plus the non-interactive overlay for UNATTENDED command execution
 * (the agent's bash tool has no TTY): make scaffolders/git fail fast instead of
 * blocking forever on a prompt no human will answer. `overrides` still win and
 * `pathPrefix` is prepended to the final PATH.
 */
export function childEnvNonInteractive(
  overrides?: NodeJS.ProcessEnv,
  pathPrefix?: string[],
): NodeJS.ProcessEnv {
  return childEnv(
    {
      CI: '1',
      npm_config_yes: 'true',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      ...overrides,
    },
    pathPrefix,
  )
}

/**
 * Fold the login-shell env into the ambient `process.env` at boot, so code paths
 * that spread `{ ...process.env }` into their own spawn (git cli, MCP, LSP,
 * cli-agent host, background bash) inherit the repaired PATH + stack vars without
 * each needing to import this module. Conservative: PATH is REPLACED (the login
 * PATH is a superset of the bare GUI one), every other login var only FILLS a key
 * the app hasn't already set — so app config (PORT/HOST/NODE_ENV/LOCALIX_*) is
 * never clobbered. Idempotent; a no-op from a terminal / on Windows / on failure.
 *
 * NOTE: this does NOT replace `childEnv()` — a spawn that passes no `env` at all
 * still sees only the process-start snapshot under Bun, so the foreground bash /
 * ripgrep path passes `childEnv()` explicitly.
 */
export function ensureLoginShellEnv(): void {
  if (applied) return
  applied = true
  const login = resolveLoginEnv()
  if (!login) return
  for (const [k, v] of Object.entries(login)) {
    if (k === 'PATH' || !(k in process.env)) process.env[k] = v
  }
}
