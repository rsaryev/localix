import type { MarketDataCandle, MarketDataConnection } from './market-data-port'
import { TRADING_CHART_CHANNEL, TRADING_MINI_APP } from './chart-command'
import { renderPatternReport } from './analysis/detect-report'
import { detectPatterns } from './analysis/pattern-detect'
import { compositeSignal, renderCompositeSignal } from './analysis/composite-signal'
import { detectRsiDivergence, renderDivergence } from './analysis/divergence'
import { renderVolatility, volatilityReadout } from './analysis/volatility'
import { hvPercentile, renderHvPercentile } from './analysis/hv-percentile'
import { renderRiskMetrics, riskMetrics } from './analysis/risk-metrics'
import {
  higherTimeframe,
  renderTimeframeContext,
  timeframeContext,
} from './analysis/timeframe-context'
import { renderDetectSummary } from './analysis/detect-summary'
import { renderStructurePosition, structurePosition } from './analysis/structure-position'
import { fibRetracement, renderFibRetracement } from './analysis/fib-retracement'
import { pivotPoints, renderPivotPoints } from './analysis/pivot-points'
import { renderRoundLevels, roundLevels } from './analysis/round-levels'
import { detectFairValueGaps, renderFairValueGaps } from './analysis/fair-value-gaps'
import { detectOrderBlocks, renderOrderBlocks } from './analysis/order-blocks'
import { detectLiquidityPools, renderLiquidityPools } from './analysis/liquidity-pools'
import { ichimokuSignal, renderIchimokuSignal } from './analysis/ichimoku-signal'
import { detectHarmonicPattern, renderHarmonicPattern } from './analysis/harmonic-patterns'
import { fundingRead, renderFundingRead } from './analysis/funding-read'
import { orderBookRead, renderOrderBookRead } from './analysis/orderbook-read'
import { detectStructureBreak, renderStructureBreak } from './analysis/structure-breaks'
import { renderVolumeProfile, valueAreaPosition, volumeProfile } from './analysis/volume-profile'
import { renderSessionVwap, sessionVwap } from './analysis/vwap-analysis'
import {
  buildSourcedLevels,
  detectConfluence,
  isAtConfluence,
  renderConfluence,
} from './analysis/confluence'
import type { ManageChartInput } from './manage-chart-input'
import type { ChartDetectPort, DetectCommandSink } from './manage-chart-detect-port'
import { detectAutoDrawPayloads } from './manage-chart-detect-draw'
import { DEFAULT_TIMEFRAME } from './timeframes'

export type { ChartDetectPort, DetectCommandSink } from './manage-chart-detect-port'

/** The detect window: the widest read `market_data` itself allows (its `candles` cap). */
const DETECT_CANDLES = 200

/** Total auto-draw overlays a single detect may add — a readable chart beats an exhaustive one.
 *  With the priority ordering, the cap sheds the most confluence-redundant raw levels first. */
const MAX_AUTO_DRAW = 10

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * `action:"detect"`, answered SERVER-SIDE from service candles; only the optional auto-draw
 * touches the UI (as standard `draw` commands). Works without a mounted chart tab.
 */
export async function runChartDetect(
  port: ChartDetectPort,
  target: Pick<MarketDataConnection, 'id' | 'name'>,
  input: ManageChartInput,
  session: DetectCommandSink | undefined,
) {
  if (!port.ohlcv) {
    return {
      content:
        'Pattern detection is unavailable in this build — the chart tool has no candle reader wired.',
      isError: true,
    }
  }
  const timeframe = input.timeframe ?? DEFAULT_TIMEFRAME
  let candles: MarketDataCandle[]
  try {
    candles = await port.ohlcv(target.id, input.symbol, timeframe, DETECT_CANDLES)
  } catch (err) {
    return {
      content: `Could not read candles for ${input.symbol} on "${target.name}": ${errorText(err)}`,
      isError: true,
    }
  }
  if (candles.length === 0) {
    return {
      content: `No ${timeframe} candles for ${input.symbol} on "${target.name}" — nothing to scan.`,
      isError: true,
    }
  }
  const report = detectPatterns(candles)
  const signal = compositeSignal(candles)
  const volatility = volatilityReadout(candles)
  const risk = riskMetrics(candles)
  // Higher-timeframe context: fetch the step-up timeframe and read its regime/trend. Computed
  // BEFORE the report is assembled so the summary can name its alignment. Best-effort — a
  // venue that does not offer the higher token simply yields no context.
  let htfCtx: ReturnType<typeof timeframeContext> | null = null
  const htf = higherTimeframe(timeframe)
  if (htf) {
    try {
      // Guarded above; called inline because a captured method trips the unbound-method lint.
      const htfCandles = await port.ohlcv!(target.id, input.symbol, htf, DETECT_CANDLES)
      if (htfCandles.length >= 8) htfCtx = timeframeContext(htfCandles, htf)
    } catch {
      /* the venue does not offer this timeframe — skip the context, never fail detect */
    }
  }

  // Perp positioning + microstructure, best-effort and IN PARALLEL (both are extra venue
  // round-trips; serializing them doubled the added latency). The book snapshot is only
  // fetched when the report will actually print it: compact renders it as detail-only,
  // and the mode sold as "the cheap read" must not pay for a line it omits.
  const wantBook = input.detail !== 'compact' && port.orderBook !== undefined
  const [funding, book] = await Promise.all([
    port.funding
      ? port
          .funding(target.id, input.symbol)
          .then(fundingRead)
          .catch(() => null)
      : Promise.resolve(null),
    wantBook
      ? port.orderBook!(target.id, input.symbol, 10)
          .then(orderBookRead)
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const lastClose = candles.at(-1)?.close
  const round = lastClose !== undefined ? roundLevels(lastClose) : null
  // Fibonacci retracement of the window's swing, oriented by trend — the pullback/bounce zones.
  const fib = fibRetracement(candles, report.trend?.direction ?? null)
  // Classic daily pivot points from the prior day — the intraday level grid.
  const pivots = pivotPoints(candles)
  // Structure break (BOS/ChoCH) + unfilled fair value gaps — computed once, shared by the
  // report lines, the confluence sources, the summary and the auto-draw.
  const structureBreak = detectStructureBreak(candles)
  const fvgs = detectFairValueGaps(candles)
  // The last opposite candle before a displacement — the SMC retest zones (unmitigated).
  const orderBlocks = detectOrderBlocks(candles)
  // Volume profile — POC + value-area edges, the volume-based S/R that also feed confluence.
  const volProfile = volumeProfile(candles)
  // Session VWAP (current UTC day) — the intraday benchmark and a confluence source.
  const vwap = sessionVwap(candles)
  // Confluence zones computed ONCE — both the summary's AT-flag and the render below read them.
  const confluenceZones =
    lastClose !== undefined
      ? detectConfluence(
          buildSourcedLevels({
            levels: report.levels,
            fib,
            pivots,
            round,
            fvgs,
            orderBlocks,
            structureBreak,
            volume: volProfile,
            vwap,
          }),
          lastClose,
        )
      : []

  // Lead with the one-line gestalt — regime, the structure break, the composite bias, HTF
  // alignment and whether price is AT a confluence zone — then the detail blocks in order.
  const summary = renderDetectSummary({
    regime: report.regime,
    trend: report.trend,
    signal,
    htf: htfCtx,
    structureBreak,
    atConfluence: isAtConfluence(confluenceZones),
    valueArea:
      volProfile && lastClose !== undefined ? valueAreaPosition(volProfile, lastClose) : null,
  })
  // Two report depths. 'full' (default) is every block; 'compact' keeps the DECISION CORE
  // (summary, confluence, structure, composite, volatility, HTF alignment) plus any block
  // whose content is a live EVENT right now (a sweep, an INSIDE zone, a gated ichimoku, a
  // completed harmonic, a vol squeeze, crowded funding). The full grid costs context a
  // repeated mid-conversation re-scan rarely needs — the `core` flag per block is the one
  // place that judgement lives.
  const compact = input.detail === 'compact'
  const lines: string[] = []
  const add = (core: boolean, ...ls: string[]) => {
    if (!compact || core) lines.push(...ls)
  }
  const liquidityPools = detectLiquidityPools(candles)
  if (summary) lines.push(summary)
  // Confluence FIRST (right under the summary): where the independent level methods agree —
  // the strongest references, synthesized from the scattered blocks below.
  if (lastClose !== undefined) {
    add(true, ...renderConfluence(confluenceZones))
    // Then where price sits between its nearest detected support/resistance.
    add(true, ...renderStructurePosition(structurePosition(report.levels, lastClose), lastClose))
    // Structure break (BOS/ChoCH) — continuation vs the first against-trend break.
    add(true, ...renderStructureBreak(structureBreak))
    if (round) add(false, ...renderRoundLevels(round))
    add(false, ...renderVolumeProfile(volProfile, lastClose))
    add(false, ...renderSessionVwap(vwap))
  }
  if (fib) add(false, ...renderFibRetracement(fib))
  if (pivots) add(false, ...renderPivotPoints(pivots))
  // SMC zones: detail — unless price is INSIDE one right now (the live decision point).
  add(
    fvgs.some((g) => g.distancePct === 0),
    ...renderFairValueGaps(fvgs),
  )
  add(
    orderBlocks.some((b) => b.distancePct === 0),
    ...renderOrderBlocks(orderBlocks),
  )
  // Stop clusters: detail — unless a sweep just printed (the reversal tell).
  add(
    liquidityPools.some((p) => p.swept),
    ...renderLiquidityPools(liquidityPools),
  )
  add(false, renderPatternReport(report, input.symbol, timeframe, candles.length))
  // The composite Trend/Momentum/Volume vote, computed over the SAME candles — a cited,
  // multi-dimension read to sit beside the levels/regime the scan already reports.
  if (signal) add(true, ...renderCompositeSignal(signal))
  // Regular/hidden RSI divergence over the recent swings — a reversal / continuation tell.
  add(false, ...renderDivergence(detectRsiDivergence(candles)))
  // A recent Ichimoku TK cross — an EVENT when the gate passed, detail when stand-aside.
  const ichimoku = ichimokuSignal(candles)
  if (ichimoku) add(ichimoku.verdict !== 'stand_aside', ...renderIchimokuSignal(ichimoku))
  // A freshly-completed harmonic XABCD — always an event (rare, and its PRZ is live).
  const harmonic = detectHarmonicPattern(candles)
  if (harmonic) add(true, ...renderHarmonicPattern(harmonic))
  // ATR volatility + stop-distance references — the numbers the plan sizes stops off.
  if (volatility) add(true, ...renderVolatility(volatility))
  // HV percentile: detail while normal, an event at either extreme (squeeze / stretch).
  const hv = hvPercentile(candles, timeframe)
  if (hv) add(hv.state !== 'normal', ...renderHvPercentile(hv))
  // Downside risk: historical VaR/CVaR per bar + max drawdown over the window.
  if (risk) add(false, ...renderRiskMetrics(risk, timeframe))
  // Perp positioning: detail while balanced, an event once a side is crowded.
  if (funding) add(funding.state !== 'balanced', ...renderFundingRead(funding))
  // Microstructure: the cost of immediacy + which side of the book is heavy right now.
  if (book) add(false, ...renderOrderBookRead(book))
  // Higher-timeframe context block, with alignment vs the scanned timeframe's trend.
  if (htfCtx) add(true, ...renderTimeframeContext(htfCtx, report.trend?.direction ?? null))
  if (compact) {
    lines.push(
      '(compact scan — the level grids, patterns, risk and microstructure blocks were omitted; run detail="full" for them)',
    )
  }
  if (input.auto_draw) {
    // Ordered HIGH-signal first so the total cap sheds the most redundant overlays, not the
    // best ones: the structure flip and the volume POC, then the SMC imbalance zones, then the
    // fib pocket, and finally the raw pattern S/R + trend (strongest-first, the most covered by
    // confluence). A clean chart beats an exhaustive one — an over-drawn chart is the clutter
    // the user called out; the numbers above are always complete regardless of what is drawn.
    const prioritized = detectAutoDrawPayloads({
      connectionId: target.id,
      symbol: input.symbol,
      report,
      structureBreak,
      volProfile,
      vwap,
      fvgs,
      orderBlocks,
      fib,
    })
    const payloads = prioritized.slice(0, MAX_AUTO_DRAW)
    const omitted = prioritized.length - payloads.length
    if (!session?.emitCommand) {
      lines.push(
        '(auto_draw skipped: no UI command channel in this run — the numbers above are complete)',
      )
    } else if (payloads.length === 0) {
      lines.push('(nothing drawable found — no drawings were added)')
    } else {
      for (const p of payloads) session.emitCommand(TRADING_MINI_APP, TRADING_CHART_CHANNEL, p)
      lines.push(
        `Drawn on the chart: ${payloads.length} overlay(s), ids ${payloads
          .map((p) => p.drawing!.id!)
          .join(
            ', ',
          )}${omitted > 0 ? ` (${omitted} lower-priority overlay(s) omitted to keep the chart readable)` : ''} — a re-detect replaces them; remove via action="draw" draw_mode="remove"/"clear".`,
      )
    }
  }
  return {
    content: lines.join('\n'),
    details: { connection: target.id, symbol: input.symbol, action: 'detect' },
    // A live-market read: a newer scan of the same market supersedes the older one.
    supersedeKey: `trading-detect:${target.id}:${input.symbol}`,
  }
}
