import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { localixHome } from './env'

/**
 * The persisted login-shell snapshots (`~/.localix/login-shell-env.json`), keyed by
 * fingerprint (`login-shell-env.ts`) rather than replacing one another, because the SAME
 * machine legitimately resolves to different environments: a terminal launch starts from the
 * user's PATH, a GUI launch from the bare launchd/systemd one. A single-slot cache would let
 * those two evict each other and neither would ever hit — precisely the case it exists for.
 *
 * Bounded so it cannot grow, and evicted by least-recent USE. The defect it replaces: four
 * slots evicted in WRITE order. Every terminal a developer opens has its own PATH, so its own
 * fingerprint; with three terminal variants stored, one more pushed out the GUI entry — which
 * had been hit on every packaged launch but written only once — and the next packaged launch
 * paid a 0.4–0.84 s `zsh -ilc` probe. So a hit moves its entry to the most-recent end (a
 * rewrite only when it was not there already, so the steady state writes nothing), and the
 * slot count leaves room for a GUI entry plus a handful of terminals.
 */

export const CACHE_VERSION = 1
export const MAX_SNAPSHOTS = 8

/**
 * How long a failed probe is believed. A timed-out probe used to be retried on EVERY boot,
 * so an rc that always overruns the budget cost its full timeout on every launch. Bounded
 * rather than permanent because a timeout can also be a one-off (a boot under load, a
 * network mount in the rc), and any rc edit changes the fingerprint and retries at once.
 */
const FAILED_PROBE_TTL_MS = 24 * 60 * 60 * 1_000

/**
 * An entry is either the delta the shell produced (`vars`, possibly EMPTY — a terminal
 * launch contributes nothing, and that is an answer worth keeping too), or a probe that
 * produced nothing in its budget (`failedAt`). `entries` runs least → most recently used.
 */
type SnapshotEntry = { key: string; vars?: Record<string, string>; failedAt?: number }
type SnapshotFile = { version: number; entries: SnapshotEntry[] }

let cacheFileOverride: string | undefined
const cacheFile = () => cacheFileOverride ?? join(localixHome(), 'login-shell-env.json')

/** Test seam: point the snapshot at a scratch file (or back at the real one). */
export function setSnapshotFile(file: string | undefined): void {
  cacheFileOverride = file
}

function readSnapshotFile(): SnapshotFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile(), 'utf8')) as SnapshotFile
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function writeEntries(entries: SnapshotEntry[]): void {
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true })
    const kept = entries.slice(-MAX_SNAPSHOTS)
    writeFileSync(cacheFile(), JSON.stringify({ version: CACHE_VERSION, entries: kept }), 'utf8')
  } catch {
    /* a cache we cannot write just means we re-probe next boot */
  }
}

/** The recorded answer: a delta, `null` for "nothing to add", `undefined` to probe. */
export function readSnapshot(key: string): Record<string, string> | null | undefined {
  const entries = readSnapshotFile()?.entries ?? []
  const at = entries.findIndex((e) => e.key === key)
  const entry = entries[at]
  let answer: Record<string, string> | null | undefined
  if (entry?.vars && typeof entry.vars === 'object') {
    answer = Object.keys(entry.vars).length ? entry.vars : null
  } else if (
    typeof entry?.failedAt === 'number' &&
    Date.now() - entry.failedAt < FAILED_PROBE_TTL_MS
  ) {
    answer = null
  }
  // Touch on hit: the entry that answered becomes the most recently used.
  if (answer !== undefined && at !== entries.length - 1) {
    writeEntries([...entries.slice(0, at), ...entries.slice(at + 1), entry!])
  }
  return answer
}

export function writeSnapshot(entry: SnapshotEntry): void {
  const kept = (readSnapshotFile()?.entries ?? []).filter((e) => e.key !== entry.key)
  writeEntries([...kept, entry])
}
