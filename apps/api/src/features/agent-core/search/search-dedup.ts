import { createReadDedupStore, type ReadDedupStore } from '../tools/file/read-dedup'

/**
 * Repeat-search bookkeeping — `read`'s dedup rule, applied to the other tool that
 * re-delivers bytes the model already has.
 *
 * THE GAP THIS FILLS. Three guards already watch a run that keeps searching, and none
 * of them sees this case:
 *
 *  - `exploration-guard.ts` counts CONSECUTIVE NON-MUTATING TURNS (nudge at 8, brake at
 *    40). It never looks at what was searched — a run alternating a search with an edit
 *    resets the streak every turn and can repeat one query forever.
 *  - `no-progress-guard.ts` catches an IDENTICAL BATCH repeating back-to-back (3×) or
 *    cycling (4× in 8). A duplicate `search` sharing its turn with a different `read`
 *    changes the batch signature, so it trips nothing.
 *  - `read-dedup.ts` covers the same waste for `read`, and only for `read`.
 *
 * So an exactly-repeated search silently re-delivers its whole result set — up to
 * `MAX_OUTPUT_BYTES` (64KB) of file:line hits the model already has a few turns up.
 *
 * WHY A NOTICE AND NOT A CAP. context-mode's flood-guard tapers results after 3 searches
 * in 60s and hard-refuses after 8. That punishes a legitimate long investigation for its
 * PACE, which is not the waste — our `search` is deliberately the cheap primitive we tell
 * the model to prefer over reads, and self-widening exists to make one search do more.
 * The waste is the DUPLICATE, and a duplicate is identifiable exactly. So this brakes
 * nothing and refuses nothing: it swaps the repeated body for a pointer at the earlier
 * result plus the better move (widen with `context`, batch the queries, read the file).
 *
 * IDENTITY is the search's full input — same `cwd`, same `query`, same `glob`, same
 * `context` — AND the same output. A near-duplicate query is a DIFFERENT search that can
 * legitimately return more, and guessing at "near" would suppress a real result; only an
 * exact repeat that returned exactly the same bytes is provably redundant. The tree is
 * live, so a repeat whose output CHANGED (a file was just edited) is real news and is
 * delivered in full — same rule as `read`'s.
 *
 * SCOPE is per-registry, i.e. per RUN, unless a host injects a longer-lived store. It is
 * never process-global: a shared map would let one session's search suppress another's
 * (the bug class `file-mtime.ts` and the background-jobs map each learned once).
 *
 * It is the READ store underneath, not a copy of it: hash-not-bytes, LRU-bounded, same
 * "same key + same bytes ⇒ already delivered" question. Only the KEY differs, and the
 * mapping is chosen so the store's `resolve()` on the first half stays correct rather
 * than merely harmless — the `cwd` IS a path, while the query/glob/context ride in the
 * window slot, which is passed through verbatim.
 */
export interface SearchDedupStore {
  /** True when this exact search last returned byte-identical output. */
  isUnchanged(key: SearchKey, output: string): boolean
  /** The `toolCallId` of the search that last delivered this key's output. */
  lastCallId(key: SearchKey): string | undefined
  /** Remember that `toolCallId` delivered `output` for this key. */
  record(key: SearchKey, output: string, toolCallId: string): void
  /** Whether a stub was already served for this key (fallback rule — see `search.ts`). */
  stubServed(key: SearchKey): boolean
  setStubServed(key: SearchKey, served: boolean): void
  dispose(): void
}

/** Everything that makes two `search` calls the same search. */
export interface SearchKey {
  query: string
  cwd: string
  glob?: string
  context?: number
}

/** `\u0001` cannot occur in a query, glob, or number, so the fields can never collide. */
const windowOf = (key: SearchKey): string =>
  `${key.query}\u0001${key.glob ?? ''}\u0001${key.context ?? ''}`

/**
 * The canonical form of a result set, for the ONE question ever asked of it: "is this the
 * same answer as last time?".
 *
 * Ripgrep walks the tree in PARALLEL, so two identical searches over an unchanged tree
 * routinely return the same hits in a DIFFERENT order — caught by this feature's own test
 * on its first run, which is why the raw bytes are not the fingerprint. Comparing them
 * directly would make the dedup misfire at random: mostly silently (a duplicate gets
 * re-delivered, i.e. the status quo), but it would leave a model-facing decision riding on
 * rg's thread scheduling.
 *
 * Sorting the lines answers the real question exactly. The same multiset of `path:line:text`
 * hits IS the same answer however it was ordered, and any real change — a hit added,
 * removed, or its text edited — still moves the sorted form. Order alone never does. The
 * DELIVERED output is untouched; only the fingerprint is normalized.
 */
export function searchOutputFingerprint(output: string): string {
  return output.split('\n').sort().join('\n')
}

/**
 * The phrase a repeat search's stub is built around. Model-facing: it REPLACES the hits
 * the model asked for, so it has to say both where they already are and what to do
 * instead of asking again.
 */
export const SEARCH_DEDUP_STUB_PHRASE = 'identical to your earlier search'

export function searchDedupStub(key: SearchKey): string {
  const scope = key.glob ? ` under glob "${key.glob}"` : ''
  return (
    `[This search is identical to your earlier search for "${key.query}"${scope}, and the results are unchanged — omitted to save tokens (scroll up to that search). ` +
    `Re-running a search you already ran cannot tell you anything new: widen the regex, pass \`context\` (2-5) to see the lines around each hit, or \`read\` the span you care about. ` +
    `If the earlier results are no longer in your context, search again and the full list comes back.]`
  )
}

export function createSearchDedupStore(): SearchDedupStore {
  const store: ReadDedupStore = createReadDedupStore()
  return {
    isUnchanged: (key, output) =>
      store.isUnchanged(key.cwd, windowOf(key), searchOutputFingerprint(output)),
    lastCallId: (key) => store.lastCallId(key.cwd, windowOf(key)),
    record: (key, output, toolCallId) =>
      store.record(key.cwd, windowOf(key), searchOutputFingerprint(output), toolCallId),
    stubServed: (key) => store.stubServed(key.cwd, windowOf(key)),
    setStubServed: (key, served) => store.setStubServed(key.cwd, windowOf(key), served),
    dispose: () => store.dispose(),
  }
}
