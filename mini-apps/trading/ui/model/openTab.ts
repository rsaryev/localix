import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import {
  DEFAULT_PUBLIC_EXCHANGE_ID,
  publicConnectionId,
  publicExchangeId,
} from '../../backend/public-connection'

/**
 * This feature owns the `trading:chart` WorkItemKind + its tab-id formula, so re-opening
 * the same market focuses the existing chart tab. Routed through the generic
 * `miniAppWorkspace.openWorkItem` seam — core names no subsystem. The tab-id builder is shared
 * with the search-domain `activate` (see `register.tsx`) so the two can't drift.
 */

export interface OpenChartArgs {
  connectionId: string
  symbol: string
  exchangeId?: string
  /** Tab title (usually `<symbol> · <venue>`). */
  name?: string
  /** The VENUE's display name alone. The header shows it under the symbol, so it must not repeat
   *  the symbol the way `name` does. */
  connectionName?: string
  /** True when `connectionId` is a live CREDENTIALED connection the account surfaces should mount
   *  for. Only an explicit opener claims this — a restored payload without it is treated as
   *  public (see {@link normalizeChartPayload}). */
  credentialed?: boolean
}

/** Stable tab id for a market chart (one tab per connection+symbol). */
export function tradingChartTabId(connectionId: string, symbol: string): string {
  return `trading:chart:${connectionId}:${encodeURIComponent(symbol)}`
}

/**
 * What a chart tab is ABOUT — the one normalized reading of a `trading:chart` payload.
 *
 * Both the RENDER (which connection the tab charts) and the REF-BUILDER (which `localix://resource/trade/…`
 * the tab drags into chat) go through this helper, so "what the tab shows" and "what the
 * tab refers to" cannot diverge. They did: the render mapped an unflagged
 * credentialed `connectionId` onto the venue's public profile while the drag ref kept the
 * raw id — a tab showing a public chart handed the agent a ref to an account-bearing
 * connection.
 *
 * The rules:
 * - A payload that CLAIMS `credentialed: true` (set only by an explicit opener) keeps its connection id — that tab charts the account's venue view.
 * - Everything else is public: an id without the claim is
 *   mapped onto the venue's ephemeral `public:<exchange>` profile, so a restored tab can
 *   never silently inherit account context.
 */
export interface ChartSource {
  connectionId: string
  /** The venue. Known for every public source; for a credentialed one only when the payload
   *  carried it (a raw connection id is opaque — never guessed from). */
  exchangeId?: string
  credentialed: boolean
}

export function normalizeChartPayload(payload: Record<string, unknown> | undefined): ChartSource {
  const rawConnectionId =
    typeof payload?.connectionId === 'string' ? payload.connectionId : undefined
  const rawExchangeId = typeof payload?.exchangeId === 'string' ? payload.exchangeId : undefined
  // Credentialed only on an explicit, non-public claim — `public:hyperliquid` with a stray flag
  // is still public.
  if (
    payload?.credentialed === true &&
    rawConnectionId !== undefined &&
    publicExchangeId(rawConnectionId) === null
  ) {
    return { connectionId: rawConnectionId, exchangeId: rawExchangeId, credentialed: true }
  }
  const exchangeId =
    rawExchangeId ??
    (rawConnectionId ? publicExchangeId(rawConnectionId) : null) ??
    DEFAULT_PUBLIC_EXCHANGE_ID
  return { connectionId: publicConnectionId(exchangeId), exchangeId, credentialed: false }
}

/** Stable tab id for a market's technicals page (one per connection+symbol). */
export function tradingTechnicalsTabId(connectionId: string, symbol: string): string {
  return `trading:technicals:${connectionId}:${encodeURIComponent(symbol)}`
}

/**
 * Open (or focus) the technicals page for a market — its own grid tab.
 *
 * An APP-LEVEL tab (`scope: null`): the page reads public market data only and acts for no chat,
 * so it has no session to name and is the same page in every chat.
 */
export function openTradingTechnicalsTab(args: { connectionId: string; symbol: string }): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'trading:technicals',
    id: tradingTechnicalsTabId(args.connectionId, args.symbol),
    title: `${args.symbol} · Technicals`,
    scope: null,
    payload: { connectionId: args.connectionId, symbol: args.symbol },
  })
}

/**
 * Open (or focus) a market's chart IN `sessionId`'s workspace. A chart asks that chat's agent
 * (its book, tape and carry clicks, the analysis wizard), so it is a session tab: opened without
 * the chat, its questions went to whichever composer was on screen.
 */
export function openTradingChartTab(sessionId: string, args: OpenChartArgs): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'trading:chart',
    id: tradingChartTabId(args.connectionId, args.symbol),
    title: args.symbol,
    scope: sessionId,
    payload: {
      connectionId: args.connectionId,
      symbol: args.symbol,
      exchangeId: args.exchangeId,
      name: args.name ?? args.symbol,
      connectionName: args.connectionName,
      credentialed: args.credentialed,
    },
  })
}
