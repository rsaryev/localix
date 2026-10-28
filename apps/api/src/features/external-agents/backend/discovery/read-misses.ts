import type { AdapterEnv, ProviderAdapter, SourceRef, SummaryFold } from '../adapters/types'
import type { SessionSummary } from '../../shared/contracts'
import { mapConcurrent } from '../adapters/usage'

const FOLD_CONCURRENCY = 8

export interface ReadMisses {
  readonly summaries: readonly SessionSummary[]
  /** By native session id: where each append-only summary's fold stopped. */
  readonly folds: ReadonlyMap<string, SummaryFold>
}

/**
 * Summaries for the refs the cache missed. An adapter that folds is handed what it last read of the
 * same session, so a transcript that only grew is read from where that read stopped; the rest
 * parse their misses whole, as they always did.
 */
export async function readMisses(
  adapter: ProviderAdapter,
  misses: readonly SourceRef[],
  previous: ReadonlyMap<string, SessionSummary>,
  previousFolds: ReadonlyMap<string, SummaryFold> | undefined,
  env: AdapterEnv,
): Promise<ReadMisses> {
  const folds = new Map<string, SummaryFold>()
  if (misses.length === 0) return { summaries: [], folds }
  const fold = adapter.foldSummary?.bind(adapter)
  if (!fold) return { summaries: await adapter.readSummaries(misses, env), folds }
  const read = await mapConcurrent(misses, FOLD_CONCURRENCY, (ref) => {
    const summary = previous.get(ref.nativeSessionId)
    const last = previousFolds?.get(ref.nativeSessionId)
    return fold(ref, summary && last ? { summary, fold: last } : undefined, env)
  })
  for (const { summary, fold: next } of read) if (next) folds.set(summary.nativeSessionId, next)
  return { summaries: read.map((entry) => entry.summary), folds }
}

/**
 * The folds to keep after a scan: a session just read keeps only the fold that read produced (none,
 * if it was not folded), an unchanged one keeps its own, and a session gone from disk loses its.
 */
export function nextFolds(
  current: ReadonlyMap<string, SummaryFold> | undefined,
  refs: readonly SourceRef[],
  misses: readonly SourceRef[],
  read: ReadonlyMap<string, SummaryFold>,
): Map<string, SummaryFold> {
  const reread = new Set(misses.map((ref) => ref.nativeSessionId))
  const next = new Map<string, SummaryFold>()
  for (const { nativeSessionId: id } of refs) {
    const fold = reread.has(id) ? read.get(id) : current?.get(id)
    if (fold) next.set(id, fold)
  }
  return next
}
