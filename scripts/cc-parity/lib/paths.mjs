import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repoRoot } from '../../lib/paths.mjs'
import { run } from '../../lib/run.mjs'

/**
 * Where the parity tool keeps things. The probe's source and the committed snapshots live in the
 * repository; everything Claude Code writes — the type declarations it generates for a mod, the
 * probe's raw recordings — lives in the gitignored cache, never in git (README.md, "Legal rules").
 */

export const TOOL_DIR = fileURLToPath(new URL('..', import.meta.url))
export const PROBE_DIR = join(TOOL_DIR, 'probe')
export const SNAPSHOT_DIR = join(TOOL_DIR, 'snapshots')
export const CACHE_DIR = join(repoRoot(), '.cache', 'cc-parity')

/** The installed Claude Code's version, as `claude --version` prints it (`2.1.310`). */
export function claudeVersion() {
  const result = run('claude', ['--version'])
  const version = /\d+\.\d+\.\d+/.exec(result.stdout ?? '')?.[0]
  if (result.status !== 0 || !version)
    throw new Error('could not read `claude --version`: is Claude Code installed and on PATH?')
  return version
}

/** The cache folder of one Claude Code version. */
export const versionCache = (version) => join(CACHE_DIR, version)

/**
 * A fresh copy of the probe in the cache, for Claude Code to load: Claude Code writes its type
 * declarations (and a `tsconfig.json`) into a mod it loads, and those must not land in the repo.
 */
export function probeCopy(name) {
  const dir = join(CACHE_DIR, 'run', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(PROBE_DIR, dir, {
    recursive: true,
    filter: (source) => !source.includes(join('.claude-plugin', 'types')),
  })
  return dir
}

/** The committed snapshot files of Claude Code, newest version first. */
export function claudeSnapshots() {
  if (!existsSync(SNAPSHOT_DIR)) return []
  return readdirSync(SNAPSHOT_DIR)
    .flatMap((file) => {
      const match = /^claude-code-(\d+)\.(\d+)\.(\d+)\.json$/.exec(file)
      return match ? [{ version: match.slice(1).join('.'), parts: match.slice(1).map(Number) }] : []
    })
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
    .map(({ version }) => version)
}

export const snapshotPath = (version) => join(SNAPSHOT_DIR, `claude-code-${version}.json`)
export const surfacePath = (version) => join(SNAPSHOT_DIR, `claude-code-${version}.surface.json`)
export const LOCALIX_SNAPSHOT = join(SNAPSHOT_DIR, 'localix.json')
