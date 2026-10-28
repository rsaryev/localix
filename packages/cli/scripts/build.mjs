#!/usr/bin/env bun
/**
 * Build script for the localix CLI package.
 *
 * The CLI is a LAUNCHER: it resolves a path and hands a `localix://open` deep link
 * to the running desktop app. It boots no server and renders no session, so the
 * build is just "bundle the typed entry" — there is no UI, API server, migration
 * or plugin payload to stage any more.
 *
 * Bundle the CLI entry DIRECTLY (src/main.ts), NOT a re-export barrel — bun's
 * bundler tree-shakes a re-export-only module down to nothing, and the shim would
 * import an undefined `runCli`.
 *
 * Run from anywhere:  bun packages/cli/scripts/build.mjs
 * Or via package:     bun run build  (inside packages/cli)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(__dirname, '..')

const ENTRY = resolve(PKG_ROOT, 'src', 'main.ts')
const OUT_DIR = resolve(PKG_ROOT, 'server')
const OUT_FILE = resolve(OUT_DIR, 'cli.js')

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

console.log('\n  ⚙  Bundling the localix launcher → packages/cli/server/cli.js…')
execFileSync('bun', ['build', ENTRY, '--target=bun', '--minify', '--outfile', OUT_FILE], {
  stdio: 'inherit',
  cwd: PKG_ROOT,
})

console.log('\n  ✓  localix CLI build complete.')
console.log('     Test source:  bun packages/cli/bin/localix.mjs --help')
console.log('     Test bundle:  LOCALIX_USE_BUNDLED=1 bun packages/cli/bin/localix.mjs --help\n')
