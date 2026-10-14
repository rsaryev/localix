import type { UsageRepository } from './repository'

/**
 * The boot-time usage reconcile, cut into pages that each fit a frame.
 *
 * The defect: the reconcile was one synchronous `bun:sqlite` statement over every assistant
 * message, measured at ~230–300 ms on a cold page cache (a 60 MB database, ~900 assistant
 * rows) and growing with history — a stall any request arriving during it waited out. A fixed
 * page size cannot fix that for every machine: payloads range from a line to megabytes, and a
 * cold disk is ten times slower than a warm one (measured: 28 MB of assistant payloads, the
 * largest 1.4 MB, cost up to ~2.7 ms per row cold). So the page size is steered by the time the
 * last page took, toward `targetMs`: doubled while pages come in well under it, scaled down
 * in proportion when one overruns, always within [MIN_PAGE, MAX_PAGE] — and cut at
 * MAX_PAGE_BYTES, because a time controller only learns about a huge row AFTER paying for it.
 * A single row larger than the budget still costs what it costs — the floor is one row.
 * Between pages the caller's `yield` hands the loop back.
 */

const MIN_PAGE = 1
const MAX_PAGE = 2_048
const FIRST_PAGE = 16
/** ~7 ms of cold JSON + overflow-page reads at the measured ~14 µs per KB. */
const MAX_PAGE_BYTES = 512 * 1024

/** The next page size, from the one just run and how long it took. */
export function nextPageSize(size: number, tookMs: number, targetMs: number): number {
  if (tookMs > targetMs * 1.5) return Math.max(MIN_PAGE, Math.floor((size * targetMs) / tookMs))
  if (tookMs < targetMs / 2) return Math.min(MAX_PAGE, size * 2)
  return size
}

export async function reconcileUsageInSlices(
  repo: Pick<UsageRepository, 'reconcileAssistantMessagePage'>,
  options: {
    yield: () => Promise<void>
    signal?: AbortSignal
    targetMs?: number
    now?: () => number
  },
): Promise<{ repaired: number; pages: number }> {
  const now = options.now ?? (() => performance.now())
  const targetMs = options.targetMs ?? 8
  let size = FIRST_PAGE
  let afterId: string | null = null
  let repaired = 0
  let pages = 0
  while (!options.signal?.aborted) {
    const started = now()
    const page = await repo.reconcileAssistantMessagePage({
      afterId,
      limit: size,
      maxBytes: MAX_PAGE_BYTES,
    })
    pages += 1
    repaired += page.repaired
    if (page.lastId === null) break
    afterId = page.lastId
    size = nextPageSize(size, now() - started, targetMs)
    await options.yield()
  }
  return { repaired, pages }
}
