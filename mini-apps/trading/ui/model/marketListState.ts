import type { MarketsState } from './useMarkets'

/**
 * Which of five things a market list is showing — decided once, in one place.
 *
 * The ladder exists because two of these are easy to collapse into one, and the collapse is a lie:
 * a read that FAILED and a venue that lists nothing produce the same empty array. `No matching
 * markets` is a claim about the venue; a rejected request is a fact about the request. The sidebar
 * rendered every failure except `unreachable` as the former, while the market picker beside it said
 * the error out loud — two surfaces over one hook, disagreeing about what had happened.
 *
 * `unreachable` is a QUIET state (the venue is down; it will come back) and outranks `error`, which
 * carries a message worth reading. Both outrank emptiness, because neither of them establishes it.
 */
export type MarketListState = 'loading' | 'unreachable' | 'error' | 'empty' | 'list'

/**
 * @param markets what `useMarkets` returned
 * @param rowCount how many rows survived the local filter/grouping — the picker counts rows, the
 *        sidebar counts grouped markets, and neither number means anything until the read succeeded
 */
export function marketListState(markets: MarketsState, rowCount: number): MarketListState {
  // A refresh over an already-loaded list keeps showing that list — blanking it on every keystroke
  // would be a worse lie than a stale row: the rows are real, they are simply from a moment ago.
  if (markets.loading && rowCount === 0) return 'loading'
  if (markets.unreachable) return 'unreachable'
  if (markets.error) return 'error'
  if (rowCount === 0) return 'empty'
  return 'list'
}
