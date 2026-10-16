import type { Market, MarketType } from '../../backend/contracts'
import { MARKET_TYPE_ORDER, rankMarkets } from '../../backend/market-rank'

/**
 * Pure market list shaping for the sidebar: filter by a query + market type, float
 * favourites into their own group, cap the total shown (a venue can list thousands of
 * markets) and REPORT the cap so the UI can show "showing N of M". Grouped by
 * `MarketType` in a stable order below the favourites. Pure so the sidebar stays a thin
 * render and every rule is unit-tested (mirrors `groupContainers`).
 *
 * WHICH markets survive the cap is not decided here — that is `backend/market-rank.ts`
 * `rankMarkets`, shared with the `localix://resource/trade` resource provider so the sidebar and the composer's
 * `@`-menu never disagree about the roster. Taking the cap off the top of the venue's own order
 * hid every Hyperliquid perpetual behind its 299 spot markets.
 */

export { MARKET_TYPE_ORDER }

/** Human labels for each market type. Exported so the chart-header market picker's category tabs
 *  name a type the same way the sidebar groups it — one label source, no drift. */
export const TYPE_LABEL: Record<MarketType, string> = {
  spot: 'Spot',
  swap: 'Perpetual',
  future: 'Futures',
  margin: 'Margin',
  option: 'Options',
}

export interface MarketGroup {
  /** Stable key: `favourites` or `type:<type>`. */
  key: string
  label: string
  /** The market type for a type group; undefined for the favourites group. */
  type?: MarketType
  markets: Market[]
}

export interface GroupedMarkets {
  groups: MarketGroup[]
  /** Total markets AFTER filtering (before the cap). */
  total: number
  /** How many are actually shown across the groups. */
  shown: number
  /** True when `total` exceeded the cap (more matched than are shown). */
  capped: boolean
}

export interface GroupMarketsOptions {
  query?: string
  /** Restrict to one market type, or 'all'. */
  type?: MarketType | 'all'
  /** Symbols the user has starred — floated into a Favourites group at the top. */
  favourites?: ReadonlySet<string>
  /** Max markets shown across all groups (default 200). */
  cap?: number
}

const DEFAULT_CAP = 200

/**
 * Case-insensitive match over the unified symbol + base + quote. `q` must already be
 * trimmed + lower-cased. Exported so the chart-header market picker filters identically.
 */
export function marketMatchesQuery(m: Market, q: string): boolean {
  if (!q) return true
  return (
    m.symbol.toLowerCase().includes(q) ||
    m.base.toLowerCase().includes(q) ||
    m.quote.toLowerCase().includes(q)
  )
}

export function groupMarkets(markets: Market[], opts: GroupMarketsOptions = {}): GroupedMarkets {
  const q = (opts.query ?? '').trim().toLowerCase()
  const favourites = opts.favourites ?? new Set<string>()
  const cap = opts.cap ?? DEFAULT_CAP

  const filtered = markets.filter(
    (m) =>
      (opts.type == null || opts.type === 'all' || m.type === opts.type) &&
      marketMatchesQuery(m, q),
  )

  // Favourites are never dropped by the cap, but they spend it: rank only what is left, against
  // whatever budget remains.
  const fav = filtered.filter((m) => favourites.has(m.symbol)).slice(0, cap)
  const rest = filtered.filter((m) => !favourites.has(m.symbol))
  const ranked = rankMarkets(rest, cap - fav.length)
  const ordered = [...fav, ...ranked.markets]

  const shownFav = ordered.filter((m) => favourites.has(m.symbol))
  const groups: MarketGroup[] = []
  if (shownFav.length) groups.push({ key: 'favourites', label: 'Favourites', markets: shownFav })

  for (const type of MARKET_TYPE_ORDER) {
    const typeMarkets = ordered.filter((m) => !favourites.has(m.symbol) && m.type === type)
    if (typeMarkets.length)
      groups.push({ key: `type:${type}`, label: TYPE_LABEL[type], type, markets: typeMarkets })
  }

  return {
    groups,
    total: filtered.length,
    shown: ordered.length,
    capped: filtered.length > ordered.length,
  }
}
