/**
 * The `technicals` market-leaf expansion — the server-computed technical rating
 * for a market, so a linked Technicals tab (or an `@` to this leaf) carries the full summary into
 * chat context WITHOUT the tab ever being opened. The math is the SAME client-side rating engine
 * the page renders (`ui/model/technicalRatings`) — the backend already imports that indicator
 * module (composite-signal/divergence/volatility do too), so eyes and agent read identical votes.
 *
 * On top of the classic tables it appends the house lenses (regime, structure break, session VWAP,
 * value area) via the same `backend/analysis` functions the `detect` tool uses — the layers beyond
 * the classic tables. Reads a wide-enough candle window to warm the long moving averages
 * (SMA/EMA 200).
 */
import type { Candle } from './contracts'
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import { failureSentence, findMarket, type ResourceTradingService } from './resource-shared'
import { computeTechnicalRatings, renderTechnicalRatingsText } from '../ui/model/technicalRatings'
import { classifyRegime, trendFit } from './analysis/pattern-detect'
import { hvPercentile, renderHvPercentile } from './analysis/hv-percentile'
import { detectLiquidityPools, renderLiquidityPools } from './analysis/liquidity-pools'
import { ichimokuSignal, renderIchimokuSignal } from './analysis/ichimoku-signal'
import { detectHarmonicPattern, renderHarmonicPattern } from './analysis/harmonic-patterns'
import { detectStructureBreak } from './analysis/structure-breaks'
import { sessionVwap } from './analysis/vwap-analysis'
import { valueAreaPosition, volumeProfile } from './analysis/volume-profile'
import { toolNumber } from './tool-number'
import { DEFAULT_TIMEFRAME, TECHNICALS_TIMEFRAMES } from './timeframes'

/** Enough bars to warm the 200-period moving averages the rating votes on. */
const TECHNICALS_BARS = 260

/** Four significant figures without exponent noise (the house tool-number rule). */
/** The house lenses (regime / structure / VWAP / value area) — the reads beyond the classic
 *  tables, computed from the same candles by the same functions the `detect` tool uses. */
function houseLenses(candles: Candle[], timeframe: string): string[] {
  const lines: string[] = []
  const price = candles.at(-1)?.close
  const regime = classifyRegime(candles, trendFit(candles))
  if (regime) lines.push(`- regime: ${regime.kind}`)
  const brk = detectStructureBreak(candles)
  if (brk) {
    lines.push(
      `- structure: ${brk.direction} ${brk.type} (${brk.type === 'BOS' ? 'continuation' : 'character change'})`,
    )
  }
  const vwap = sessionVwap(candles)
  if (vwap) {
    lines.push(
      `- session VWAP: ${toolNumber(vwap.vwap)} (price ${vwap.distancePct >= 0 ? '+' : ''}${vwap.distancePct.toFixed(2)}%)`,
    )
  }
  const vp = volumeProfile(candles)
  if (vp && price !== undefined) {
    lines.push(`- value area: ${valueAreaPosition(vp, price)} (POC ${toolNumber(vp.poc)})`)
  }
  const hv = hvPercentile(candles, timeframe)
  if (hv) lines.push(...renderHvPercentile(hv))
  // Event-driven reads: only when something actually printed (same modules detect uses).
  lines.push(...renderLiquidityPools(detectLiquidityPools(candles)))
  const ichimoku = ichimokuSignal(candles)
  if (ichimoku) lines.push(...renderIchimokuSignal(ichimoku))
  const harmonic = detectHarmonicPattern(candles)
  if (harmonic) lines.push(...renderHarmonicPattern(harmonic))
  return lines
}

/** The page's timeframe strip, as one agent line: each rung's SUMMARY verdict, best-effort —
 *  a timeframe the venue refuses (or that can't warm the ratings) is simply absent. Fetched in
 *  parallel; the base timeframe REUSES the candles the headline rating was computed from (the
 *  service ohlcv read only coalesces CONCURRENT calls — it is not a TTL cache, and a re-fetch
 *  could even disagree with the headline if a bar rolled between the two reads). */
const LADDER = TECHNICALS_TIMEFRAMES

async function timeframeLadderLine(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
  base: { timeframe: string; candles: Candle[] },
): Promise<string | null> {
  const rungs = await Promise.all(
    LADDER.map(async (tf) => {
      try {
        const candles =
          tf === base.timeframe
            ? base.candles
            : await service.ohlcv(userId, id, symbol, tf, { limit: TECHNICALS_BARS })
        const verdict = computeTechnicalRatings(candles)?.summary.verdict
        return verdict ? `${tf} ${verdict.replace('_', ' ').toUpperCase()}` : null
      } catch {
        return null
      }
    }),
  )
  const present = rungs.filter((r): r is string => r !== null)
  if (present.length < 2) return null // one rung is the main rating already — no ladder to speak of
  return (
    `- timeframe ladder (summary verdict per rung — trading with the higher timeframes is the ` +
    `most repeated edge in the literature): ${present.join(' · ')}`
  )
}

export async function expandTechnicals(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
  timeframe = DEFAULT_TIMEFRAME,
): Promise<ResourceExpansion> {
  const market = await findMarket(service, userId, id, symbol).catch(() => null)
  let candles: Candle[]
  try {
    candles = await service.ohlcv(userId, id, symbol, timeframe, { limit: TECHNICALS_BARS })
  } catch (err) {
    return { ok: false, error: failureSentence(err) }
  }
  if (candles.length === 0)
    return { ok: false, error: 'The venue returned no candles to rate this market on.' }

  const ratings = computeTechnicalRatings(candles)
  if (!ratings)
    return {
      ok: false,
      error: `There are not enough ${timeframe} candles to rate ${symbol}.`,
    }

  const price = candles.at(-1)?.close
  const header = [
    `Technical rating for ${market?.symbol ?? symbol} on connection ${id}${
      price !== undefined ? ` — last ${toolNumber(price)}` : ''
    }.`,
  ]
  const lenses = houseLenses(candles, timeframe)
  const ladder = await timeframeLadderLine(service, userId, id, symbol, {
    timeframe,
    candles,
  })
  if (ladder) lenses.push(ladder)
  const lensBlock = lenses.length ? ['', 'Beyond the classics (house lenses):', ...lenses] : []
  return {
    ok: true,
    content: [
      ...header,
      '',
      renderTechnicalRatingsText(market?.symbol ?? symbol, timeframe, ratings),
      ...lensBlock,
    ].join('\n'),
  }
}
