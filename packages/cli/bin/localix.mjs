#!/usr/bin/env bun
/**
 * Localix launcher — a thin shim in front of the typed CLI (`src/`: main → args →
 * commands).
 *
 * The `localix` command is a REMOTE CONTROL for the desktop app. It NEVER boots a server and
 * NEVER opens a browser:
 *
 *   localix            → hand `localix://open?path=<cwd>` to the RUNNING desktop app
 *   localix .          → the same, written explicitly
 *   localix <path>     → same, for a directory (project) or file (editor tab)
 *
 * The workspace UI is the desktop app's business (or `bun dev` in the repo) — not
 * this command's. See docs/features/cli.md.
 *
 * npm requires a bin to be plain JS, so this file only resolves host facts (where
 * Bun lives, bundle vs. repo source) and hands them to the TS layer.
 */

import { spawn, spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PKG_ROOT = resolve(__dirname, '..')
// CLI entry: the staged bundle (server/cli.js, written by the desktop packager)
// or, in the repo/published package, the TS source.
const CLI_BUNDLE = resolve(PKG_ROOT, 'server', 'cli.js')
const CLI_SOURCE = resolve(PKG_ROOT, 'src', 'main.ts')
// Opt into the exact artifact produced by the desktop packager even while the
// source tree is present. Useful for release smoke tests from inside the repo.
const USE_BUNDLED = process.env.LOCALIX_USE_BUNDLED === '1'

// ─── utilities ───────────────────────────────────────────────────────────────

function locateBun() {
  // Fast path when the shim itself runs under Bun (bunx / global bun install):
  // Bun.which resolves PATH natively — no probe spawns needed.
  try {
    const hit = typeof Bun !== 'undefined' && Bun.which?.('bun')
    if (hit) return hit
  } catch {
    /* fall through to the probe list (node host) */
  }
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const candidates = [
    'bun',
    resolve(HOME, '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
    'C:\\Users\\' + (process.env.USERNAME ?? '') + '\\.bun\\bin\\bun.exe',
  ]
  for (const c of candidates) {
    try {
      if (spawnSync(c, ['--version'], { stdio: 'pipe' }).status === 0) return c
    } catch {
      /* skip */
    }
  }
  return null
}

/** The CLI package version, printed by `--version`. Best-effort. */
function readVersion() {
  try {
    return JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

// ─── the typed CLI ───────────────────────────────────────────────────────────

async function loadCli() {
  // Prefer the source over the bundle: `server/cli.js` is a gitignored staged
  // artifact that goes stale during development, so a developer would otherwise
  // keep running old code. The desktop-staged install has no source tree and
  // falls back to the bundle.
  if (!USE_BUNDLED && existsSync(CLI_SOURCE)) return import(CLI_SOURCE)
  return import(CLI_BUNDLE)
}

async function runCliCommand(argv) {
  const { runCli } = await loadCli()
  await runCli(argv, { version: readVersion() })
}

// One clean exit for any async launch failure (CLI load, runCli reject) —
// otherwise these surface as a raw unhandled-rejection stack.
function fail(err) {
  console.error('\n  ✗ ', err instanceof Error ? err.message : String(err), '\n')
  process.exit(1)
}

// ─── entry point ─────────────────────────────────────────────────────────────
//
// Every invocation — bare, a path, or a command — goes to the typed CLI, which
// routes it (see src/args.ts: a path-like first token → `open`, and `open` is
// also the default). There is no server-launch branch here by design.

const isBun = typeof Bun !== 'undefined' || /bun/i.test(process.execPath ?? '')
const argv = process.argv.slice(2)

if (isBun) {
  runCliCommand(argv).catch(fail)
} else {
  // Node host: re-exec under Bun, which is what runs the TypeScript entry.
  const bun = locateBun()
  if (!bun) {
    console.error(
      '\n  ✗  Bun is required to run Localix. Install: npm install -g bun  (or see https://bun.sh/docs/installation)\n',
    )
    process.exit(1)
  }
  const child = spawn(bun, ['run', __filename, ...argv], { stdio: 'inherit' })
  child.on('error', fail)
  child.on('exit', (c) => process.exit(c ?? 0))
}
