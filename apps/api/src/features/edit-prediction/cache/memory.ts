/**
 * In-memory L1 backend result cache for edit prediction: the shared bounded LRU with single-flight
 * (`lib/result-cache.ts`), given edit prediction's rules — only the two SUCCESS outcomes are kept,
 * a prediction with edits is positive, and a caller that left is told `cancelled`.
 */

import { createResultCache } from '../../../lib/result-cache'
import type { EditPredictionCacheOptions, EditPredictionResultCache } from './contracts'
import type { NextEditResult } from '../contracts'

/** Positive results (with edits) survive a short undo/redo loop. */
const DEFAULT_POSITIVE_TTL_MS = 90_000
/** Negative (empty) results are cheap to recompute; keep them briefly. */
const DEFAULT_NEGATIVE_TTL_MS = 10_000
/** Retained-bytes ceiling for the bounded LRU. */
const DEFAULT_MAX_BYTES = 512 * 1024

export function createEditPredictionCache(
  opts: EditPredictionCacheOptions = {},
): EditPredictionResultCache {
  return createResultCache<NextEditResult>(
    {
      // Only the two SUCCESS outcomes may be cached; failures/aborts never are.
      isCacheable: (value) => value.outcome === 'predicted' || value.outcome === 'empty',
      isPositive: (value) => Boolean(value.edits && value.edits.length > 0),
      cancelled: { outcome: 'cancelled', edits: null },
    },
    {
      maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
      positiveTtlMs: opts.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS,
      negativeTtlMs: opts.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS,
      ...(opts.now ? { now: opts.now } : {}),
    },
  )
}
