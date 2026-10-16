import type { Market, MarketType } from '../../backend/contracts'
import { MARKET_TYPE_ORDER, rankMarkets } from '../../backend/market-rank'
import { TYPE_LABEL, marketMatchesQuery } from './groupMarkets'

/**
 * Pure shaping for the chart-header MARKET PICKER (the Hyperliquid-style switcher opened from the
 * symbol). Distinct from `groupMarkets` (the sidebar's grouped-by-type tree): the picker is a
 * SINGLE flat list under a chosen category TAB, so a `cmdk` list can navigate every row with one
 * ↑/↓ chain. Every rule lives here and is unit-tested; the component stays a thin render.
 *
 * Category tabs are DERIVED from the loaded roster — never a hardcoded venue vocabulary. `All` and
 * `Favourites` are always present; a per-type tab appears only for a `MarketType` the venue
 * actually reports (in the shared `MARKET_TYPE_ORDER`), and `Third-party` only when the roster
 * carries a market some operator other than the exchange deployed. WHICH rows survive the cap is
 * `rankMarkets` (the same rule the sidebar and the `@`-menu use), so the surfaces never disagree
 * about the slice.
 *
 * A venue's own product taxonomy is NOT reproduced here. Hyperliquid's switcher offers Outcome,
 * Crypto, Tradfi, Trending and Pre-launch tabs; none of those is a fact the exchange puts on a
 * market through ccxt's unified shape, so a tab of that name here could only be guessed from a
 * ticker string. A tab called `Tradfi` that quietly omits half the equities is worse than no tab:
 * the trader reads an empty category as an absent market. `Third-party` is the one that survives,
 * because the venue itself flags those markets and `Market.operator` carries the flag.
 */

/** `all` | `favourites` | `type:<MarketType>`. */
export interface MarketPickerTab {
  key: string
  label: string
  /** Set only for a per-type tab. */
  type?: MarketType
}

export const ALL_TAB: MarketPickerTab = { key: 'all', label: 'All' }
export const FAVOURITES_TAB: MarketPickerTab = { key: 'favourites', label: 'Favourites' }
/** Markets a third party deployed inside the exchange (`Market.operator` is set). */
export const OPERATOR_TAB: MarketPickerTab = { key: 'operator', label: 'Third-party' }

/**
 * The tab bar for a roster: `All`, `Favourites`, one tab per market type PRESENT in `markets`
 * (ordered by {@link MARKET_TYPE_ORDER}), and `Third-party` when any market carries an `operator`.
 * A spot-only venue shows just `All`/`Favourites`/`Spot`; a venue reporting no perps never grows a
 * `Perpetual` tab; an exchange that deploys every market itself never grows `Third-party`.
 */
export function buildMarketTabs(markets: readonly Market[]): MarketPickerTab[] {
  const present = new Set<MarketType>()
  let hasOperator = false
  for (const m of markets) {
    present.add(m.type)
    if (m.operator) hasOperator = true
  }
  const typeTabs = MARKET_TYPE_ORDER.flatMap((t): MarketPickerTab[] =>
    present.has(t) ? [{ key: `type:${t}`, label: TYPE_LABEL[t], type: t }] : [],
  )
  return [ALL_TAB, FAVOURITES_TAB, ...typeTabs, ...(hasOperator ? [OPERATOR_TAB] : [])]
}

export interface PickerRows {
  /** Capped, ordered rows for the active tab + query. */
  rows: Market[]
  /** How many matched before the cap. */
  total: number
  /** True when the cap dropped a match — the caller MUST say so. */
  capped: boolean
}

export interface FilterMarketRowsOptions {
  query?: string
  /** Active tab key; defaults to `all`. */
  tab?: string
  favourites?: ReadonlySet<string>
  /** Max rows shown (default 200). */
  cap?: number
}

/**
 * How many rows a tab renders before the caller must say it truncated.
 *
 * Bounded by the price route's own symbol limit (`tickersRequestSchema`, 500): the picker asks for a
 * quote per row on screen, in one request. A cap above that would silently drop the prices of the
 * rows past it — every row would still render, and the ones the request could not carry would look
 * like markets the venue declined to price. The binding is asserted in the tests, not remembered.
 */
export const DEFAULT_CAP = 500

function tabMatches(m: Market, tab: string, favourites: ReadonlySet<string>): boolean {
  if (tab === ALL_TAB.key) return true
  if (tab === FAVOURITES_TAB.key) return favourites.has(m.symbol)
  if (tab === OPERATOR_TAB.key) return !!m.operator
  if (tab.startsWith('type:')) return m.type === tab.slice('type:'.length)
  return true
}

/**
 * Rows for the active tab + search query. Filters by tab then query, then ranks + caps via the
 * shared `rankMarkets`. Favourites are matched by the live set (so unstarring in the picker empties
 * the Favourites tab immediately).
 */
export function filterMarketRows(
  markets: readonly Market[],
  opts: FilterMarketRowsOptions = {},
): PickerRows {
  const q = (opts.query ?? '').trim().toLowerCase()
  const favourites = opts.favourites ?? new Set<string>()
  const tab = opts.tab ?? ALL_TAB.key
  const cap = opts.cap ?? DEFAULT_CAP

  const filtered = markets.filter((m) => tabMatches(m, tab, favourites) && marketMatchesQuery(m, q))
  const ranked = rankMarkets(filtered, cap)
  return { rows: ranked.markets, total: filtered.length, capped: ranked.capped }
}
