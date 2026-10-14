import type { MarketLeaf } from '../../backend/uri'

/**
 * Which `localix://resource/trade/…/markets/<symbol>/<leaf>` a market-side-panel tab is showing.
 *
 * The UI's words and the grammar's are not the same words, so the translation is a tested
 * function rather than an identity cast. "Trades" here is the VENUE's public tape (`trades`),
 * never an account's own executions (`fills`) — linking the wrong one would hand the agent
 * a different fact than the one on screen.
 */
export function marketTabLeaf(tab: 'book' | 'trades'): MarketLeaf {
  switch (tab) {
    case 'book':
      return 'orderbook'
    case 'trades':
      return 'trades'
  }
}

/** The chat-pill label for a linked market tab — what the leaf IS, for a given symbol. */
export function marketTabLabel(tab: 'book' | 'trades', symbol: string): string {
  return `${symbol} ${tab === 'book' ? 'order book' : 'trades'}`
}

/** The account sections the credentialed side panel adds. Owned HERE (model layer) so the
 *  panel, the ref builders and their tests all name one vocabulary. */

/**
 * Which `localix://resource/trade/<conn>/<category>` an account tab is showing. The tab words happen to BE
 * grammar tokens today, but the translation stays a tested function for the same reason as
 * {@link marketTabLeaf}: `fills` (executions, with the fee paid) and `orders` (intents) are
 * one rename away from drifting apart from what the screen shows.
 */
