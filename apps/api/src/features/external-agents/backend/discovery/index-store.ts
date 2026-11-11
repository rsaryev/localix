/**
 * The session index's one document on disk: summaries, folds, and the walks still owed.
 *
 * ONE document whose name is a constant. An earlier shape was one file per provider, named by
 * sanitizing the provider id into a path segment — a near-copy of a security primitive the repo
 * owns elsewhere (`safeFileKey`), and a subtly wrong one. The provider id lives in the JSON instead,
 * so no value ever becomes a path segment. Any provider's change rewrites the whole document; at
 * the real size (3,700 summaries, ~7 MB) that is a few milliseconds of `JSON.stringify`.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SummaryFold } from '../adapters/types'
import type { SessionSummary } from '../../shared/contracts'

/**
 * Bumped when the summary shape or a parser changes in a way that invalidates stored rows.
 *
 * 10: summaries carry `empty`, and a Claude Code tool result is no longer counted as a message. A
 * row cached under 9 kept its inflated count and listed a transcript with no message at all.
 *
 * 9: a Claude Code session's title is the name set with `/rename` when there is one. A row cached
 * under 8 kept the generated title until its file changed. Since the two-depth index a bump costs a
 * cold LIST (under a second on a 10 GB history), and the usage walk again only when statistics ask.
 *
 * 8: Gemini sessions carry a `cwd`, resolved from `~/.gemini/projects.json`. Nothing about the shape
 * moved — the derivation did, which `cache-shape.test.ts` cannot see: a row cached under 7 parses
 * cleanly and keeps its empty attribution until its file happens to change.
 *
 * 7: sessions carry `model`. 6: sessions carry `quotas`. A stale row parses fine without a new
 * field, and the symptom is silence rather than an error — which is why each needed a bump.
 *
 * `unwalked` needed none: a document without it was written by a build that walked everything.
 */
export const CACHE_VERSION = 10

export interface CacheFile {
  version: number
  /** provider id -> `<sessionId>|<revision>` -> summary. */
  providers: Record<string, Record<string, SessionSummary>>
  /** provider id -> native session id -> where that session's append-only fold stopped. */
  folds?: Record<string, Record<string, SummaryFold>>
  /** provider id -> the sessions a list read summarized without walking their usage. */
  unwalked?: Record<string, string[]>
}

export interface IndexState {
  readonly summaries: Map<string, Map<string, SessionSummary>>
  readonly folds: Map<string, Map<string, SummaryFold>>
  readonly unwalked: Map<string, Set<string>>
}

export function emptyIndexState(): IndexState {
  return { summaries: new Map(), folds: new Map(), unwalked: new Map() }
}

export function indexPath(stateDir: string): string {
  return join(stateDir, 'index.json')
}

/** A missing, corrupt or older document is a cold start, never an error: history is the truth. */
export async function readIndexState(path: string): Promise<IndexState> {
  const state = emptyIndexState()
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CacheFile
    if (parsed.version !== CACHE_VERSION || !parsed.providers) return state
    for (const [provider, entries] of Object.entries(parsed.providers))
      state.summaries.set(provider, new Map(Object.entries(entries)))
    for (const [provider, entries] of Object.entries(parsed.folds ?? {}))
      state.folds.set(provider, new Map(Object.entries(entries)))
    for (const [provider, ids] of Object.entries(parsed.unwalked ?? {}))
      state.unwalked.set(provider, new Set(ids))
  } catch {
    // Cold start.
  }
  return state
}

/** temp+rename: a crash mid-write must not leave a half document that fails every later boot. */
export async function writeIndexState(path: string, state: IndexState): Promise<void> {
  const record = <T, U>(map: Map<string, T>, value: (entry: T) => U) =>
    Object.fromEntries([...map].map(([provider, entry]) => [provider, value(entry)]))
  const payload: CacheFile = {
    version: CACHE_VERSION,
    providers: record(state.summaries, (map) => Object.fromEntries(map)),
    folds: record(state.folds, (map) => Object.fromEntries(map)),
    unwalked: record(state.unwalked, (ids) => [...ids]),
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(payload), 'utf8')
  await rename(tmp, path)
}
