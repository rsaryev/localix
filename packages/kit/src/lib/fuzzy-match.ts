/**
 * Which characters of `text` a fuzzy `query` matched — the highlight that shows WHY a result
 * ranked. `null` when `query` does not match `text` at all (e.g. the match was on a different part
 * of the path, so the displayed segment shouldn't light up).
 *
 * This is the shared positional matcher (`@localixai/search/positions`) that the tiered pickers
 * also rank with, re-exported under the kit's long-standing name: a separate greedy scan here used
 * to light characters the ranker never matched (`mit` lit the first `m` of `commit`).
 */
export { matchPositions as fuzzyMatchPositions } from '@localixai/plugin-sdk/ui/utilities'
