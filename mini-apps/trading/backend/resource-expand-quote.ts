/**
 * The quote/carry leaves of the `localix://resource/trade` expansions (`resource-expand.ts`): the one-line
 * ticker, the funding sentence and the contract-carry lines the market-side expansions share —
 * plus the tiny cell formatters every sibling renders through. See that module's header for the
 * failed-read discipline all of these obey.
 */
import type { FundingRate, Market, Ticker } from './contracts'
import { orderBookSpread } from './slippage'
import { formatCountdown } from './time-format'
import { withSizeUnit } from './size-unit'
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import { failureSentence, findMarket, type ResourceTradingService } from './resource-shared'

export const num = (v: number | undefined): string => (v === undefined ? '—' : String(v))
/** Unix seconds → a compact `YYYY-MM-DD HH:MM` UTC stamp for a candle/trade row. */
export const stamp = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')
export const msStamp = (unixMs: number): string => new Date(unixMs).toISOString().slice(11, 19)

export function oneLineTicker(t: Ticker, market?: Market): string {
  const chg = t.change === undefined ? '' : ` (${(t.change * 100).toFixed(2)}% 24h)`
  const parts = [`last ${num(t.last)}${chg}`, `bid ${num(t.bid)} / ask ${num(t.ask)}`]
  // The spread, from the SAME `orderBookSpread` the `market_data` tool and the UI order book use —
  // top of book is a one-level book. A linked market that omits it hides its cheapest liquidity signal.
  if (t.bid !== undefined && t.ask !== undefined) {
    const s = orderBookSpread([[t.bid, 0]], [[t.ask, 0]])
    if (s.spread !== null && s.spreadBps !== null)
      parts.push(`spread ${num(s.spread)} (${s.spreadBps.toFixed(1)} bps)`)
  }
  // A venue with a thin ticker (Hyperliquid) reports no 24h range and no base volume. Printing
  // `24h H — L — · vol —` is three em-dashes of noise pretending to be data.
  if (t.high !== undefined || t.low !== undefined)
    parts.push(`24h H ${num(t.high)} L ${num(t.low)}`)
  // ccxt's `baseVolume` is the venue's own count — CONTRACTS on a contract market.
  if (t.baseVolume !== undefined)
    parts.push(`vol ${market ? withSizeUnit(String(t.baseVolume), market) : t.baseVolume}`)
  else if (t.quoteVolume !== undefined) parts.push(`quote vol ${t.quoteVolume}`)
  return `Quote: ${parts.join(' · ')}.`
}

/**
 * The rate is stated per the venue's OWN period and never annualised: Hyperliquid funds hourly,
 * most venues every 8h, so "×3 for a day" is wrong by 8× here. An unreported period is named as
 * unreported rather than assumed.
 */
function fundingSentence(f: FundingRate): string {
  const pct = (f.rate * 100).toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
  const per = f.interval
    ? `per ${f.interval}`
    : "per the venue's funding period (interval not reported)"
  const who = f.rate > 0 ? 'longs pay shorts' : f.rate < 0 ? 'shorts pay longs' : 'no payment'
  // Absolute time AND a relative countdown, like `market_data` — so a linked perpetual tells the
  // reader whether funding is imminent, via the SAME shared `formatCountdown`.
  const countdown =
    f.nextFundingTime !== undefined ? formatCountdown(f.nextFundingTime - Date.now()) : null
  const next =
    f.nextFundingTime !== undefined
      ? `, next settlement ${new Date(f.nextFundingTime).toISOString()}${countdown ? ` (in ${countdown})` : ''}`
      : ''
  return `Funding: ${pct}% ${per} (${who}${next}). Do not annualise without the interval.`
}

/**
 * A contract's public carry — funding + open interest. Shared by the market expansion and the
 * market `funding` leaf so the two cannot drift. A read that FAILED says so — `— no funding`
 * would read as "free to hold", which is a claim about money.
 */
export async function contractCarryLines(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
  market: Market,
): Promise<string[]> {
  const lines: string[] = []
  const [funding, oi] = await Promise.allSettled([
    service.fundingRate(userId, id, symbol),
    service.openInterest(userId, id, symbol),
  ])
  if (funding.status === 'fulfilled') {
    if (funding.value) lines.push(fundingSentence(funding.value))
  } else {
    lines.push(`Funding unavailable: ${failureSentence(funding.reason)}`)
  }
  if (oi.status === 'fulfilled') {
    // ccxt's `openInterestAmount` counts CONTRACTS, not coins — it is OKX's `oi`, not `oiCcy`.
    // On Hyperliquid a contract IS a coin, so `withSizeUnit` prints the base there and `cont`
    // where that is what the number means.
    if (oi.value?.amount !== undefined)
      lines.push(`Open interest: ${withSizeUnit(String(oi.value.amount), market)}.`)
    else if (oi.value?.value !== undefined)
      lines.push(`Open interest: ${oi.value.value} ${market.quote}.`)
  } else {
    lines.push(`Open interest unavailable: ${failureSentence(oi.reason)}`)
  }
  return lines
}

/** The market `funding` leaf — the instrument's public carry, standalone. */
export async function expandMarketFunding(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<ResourceExpansion> {
  const market = await findMarket(service, userId, id, symbol)
  if (!market) return { ok: false, error: `The exchange does not list the market "${symbol}".` }
  if (!market.contract) {
    return {
      ok: true,
      content: `${symbol} is a ${market.type} market — no funding (funding applies to perpetual/contract markets).`,
    }
  }
  const lines = await contractCarryLines(service, userId, id, symbol, market)
  return { ok: true, content: `${symbol} carry:\n${lines.join('\n')}` }
}

export async function expandTicker(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<ResourceExpansion> {
  const t = await service.ticker(userId, id, symbol).catch(() => null)
  return t
    ? { ok: true, content: `${symbol} — ${oneLineTicker(t)}` }
    : { ok: false, error: 'The venue returned no ticker for this market.' }
}
