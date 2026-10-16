import type { Market } from '../../backend/contracts'
import { TYPE_LABEL } from './groupMarkets'

/**
 * Pure badges for a market row, derived ONLY from data we already hold — no venue-specific
 * hardcoding, nothing invented.
 *
 * **Operator.** A single ticker is not unique: Hyperliquid lists `AAPL/USDC` (its own spot market)
 * alongside `XYZ-AAPL/USDC:USDC`, `KM-AAPL/USDH:USDH`, … — one perp per third-party operator, on
 * different quote currencies, with different liquidity and different liquidation risk. Two rows
 * reading "AAPL" are two different instruments, so the row surfaces `Market.operator` as a badge.
 * That field is set from the VENUE's own flag, never guessed from a hyphen — no operator name is
 * hardcoded, and an ordinary market whose base contains a dash (`ZM-USDC`) carries none.
 *
 * **Leverage.** `limits.maxLeverage` is the venue's CAP for the market (`30x`), not the user's
 * chosen leverage — labelled as a cap, never as a position setting.
 */

/**
 * The third party that deployed the market (`XYZ-AAPL/USDC:USDC` → `xyz`), lower-cased for the
 * badge. `null` when the exchange itself lists it.
 */
export function marketDexBadge(market: Market): string | null {
  return market.operator ? market.operator.toLowerCase() : null
}

/**
 * The venue's max-leverage cap as a badge string (`30x`), or `null` when the venue reports none.
 * A whole multiple drops its decimals (`30x`, not `30.0x`); a fractional cap keeps one.
 */
export function marketLeverageBadge(market: Market): string | null {
  const lev = market.limits.maxLeverage
  if (lev == null || !Number.isFinite(lev) || lev <= 0) return null
  const text = Number.isInteger(lev) ? String(lev) : lev.toFixed(1)
  return `${text}x`
}

/**
 * `'inactive'` when the venue reports this market delisted/halted (`active === false`), else `null`.
 * The tools + the `localix://resource/trade` link + the order pre-flight all flag it; the switcher and chart header
 * flag it too, so a human never opens a dead market's chart without seeing it is dead.
 */
export function marketInactiveBadge(market: Market): string | null {
  return market.active ? null : 'inactive'
}

/**
 * The second line of a market row: what the symbol does NOT already say.
 *
 * A row titled `AAPL/USDC` was subtitled `AAPL/USDC` — the base/quote pair spelled out under a
 * symbol that already is the base/quote pair. A repeated line is not free: it costs a row's worth of
 * attention and teaches the eye that the second line carries nothing, so it stops being read on the
 * rows where it carries the market type.
 *
 * The pair is shown only when the symbol differs from it (a derivative's symbol carries a settle
 * suffix: `BTC/USDC:USDC`). The market type is always shown — it is the fact the symbol never spells
 * out, and it is what separates a spot buy from a leveraged one.
 */
export function marketRowSubtitle(market: Market): string {
  const pair = `${market.base}/${market.quote}`
  const type = TYPE_LABEL[market.type]
  return market.symbol === pair ? type : `${pair} · ${type}`
}
