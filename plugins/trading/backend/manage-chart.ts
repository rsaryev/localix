import { defineAgentTool } from '@localixai/agent/agents'
import type { MarketDataCandle, MarketDataConnection } from './market-data-port'
import { TRADING_CHART_CHANNEL, TRADING_PLUGIN, type ChartCommandPayload } from './chart-command'
import { classifyManageChartCall } from './manage-chart-class'
import { detectDrawPayloads, renderPatternReport } from './analysis/detect-report'
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
import { fibDrawPayloads, fibRetracement, renderFibRetracement } from './analysis/fib-retracement'
import { pivotPoints, renderPivotPoints } from './analysis/pivot-points'
import { renderRoundLevels, roundLevels } from './analysis/round-levels'
import {
  detectFairValueGaps,
  fvgDrawPayloads,
  renderFairValueGaps,
} from './analysis/fair-value-gaps'
import {
  detectOrderBlocks,
  orderBlockDrawPayloads,
  renderOrderBlocks,
} from './analysis/order-blocks'
import { detectLiquidityPools, renderLiquidityPools } from './analysis/liquidity-pools'
import { ichimokuSignal, renderIchimokuSignal } from './analysis/ichimoku-signal'
import { detectHarmonicPattern, renderHarmonicPattern } from './analysis/harmonic-patterns'
import { fundingRead, renderFundingRead } from './analysis/funding-read'
import { orderBookRead, renderOrderBookRead } from './analysis/orderbook-read'
import type { FundingRate, OrderBook } from './contracts'
import {
  detectStructureBreak,
  renderStructureBreak,
  structureBreakDrawPayloads,
} from './analysis/structure-breaks'
import { renderVolumeProfile, valueAreaPosition, volumeProfile } from './analysis/volume-profile'
import { renderSessionVwap, sessionVwap } from './analysis/vwap-analysis'
import {
  buildSourcedLevels,
  detectConfluence,
  isAtConfluence,
  renderConfluence,
} from './analysis/confluence'
import { describeChartDrawing } from './chart-drawing'
import { describeChartSnapshot, parseChartSnapshotResult } from './chart-snapshot'
import { indicatorLabel, parseIndicatorId } from './indicator-spec'
import {
  buildChartCommandPayload,
  manageChartInputSchema,
  manageChartProblem,
} from './manage-chart-schema'
import { buildChartDrawings } from './manage-chart-draw'
import { DEFAULT_PUBLIC_EXCHANGE_ID, publicConnectionId } from './public-connection'

/**
 * `manage_chart` — the agent's hands on the Trading workspace's chart. ONE tool, one action enum
 * (open / set_timeframe / set_indicators / set_chart_type / navigate), mirroring `manage_orders`.
 *
 * Route B (typed command stream): it does not touch the venue at all — it validates, resolves the
 * connection, and emits ONE command payload as a `plugin.command` stream frame
 * (`session.emitCommand` → `plugin.command` → pluginCommandBus), keyed `trading`/`chart`.
 * Replayable + non-coalescing: two back-to-back commands both arrive, and a reconnecting client
 * still receives what it missed (deduped by the envelope's commandId). The trading UI's sink
 * opens/focuses the chart tab and applies the command — unless the run belongs to a BACKGROUND
 * session, in which case the sink applies without stealing focus. Mutating actions are
 * fire-and-forget: the result text states what was COMMANDED — the chart in the UI is where it
 * shows. `snapshot` is the one ROUND-TRIP: it awaits the sink's reply over the plugin-command
 * registry (`emitCommandWithReply`, correlated by commandId) and is strictly read-only — the sink
 * answers from its state store and never opens the tab.
 */

export interface ManageChartToolOptions {
  port: {
    listConnections(): Promise<MarketDataConnection[]>
    /** READ-ONLY, for `action:'detect'` only: the same service candles `market_data` reads.
     *  Optional — a build that doesn't wire it gets an honest "detection unavailable". */
    ohlcv?(
      connectionId: string,
      symbol: string,
      timeframe: string,
      limit: number,
    ): Promise<MarketDataCandle[]>
    /** READ-ONLY, best-effort: the perp's current funding rate for the positioning read. A spot
     *  market (or a venue without one) rejects — detect simply omits the line. */
    funding?(connectionId: string, symbol: string): Promise<FundingRate | null>
    /** READ-ONLY, best-effort: one depth snapshot for the microstructure read (spread + top-of-
     *  book imbalance). A venue without depth rejects — the line is simply absent. */
    orderBook?(connectionId: string, symbol: string, limit: number): Promise<OrderBook>
  }
}

/** The detect window: the widest read `market_data` itself allows (its `candles` cap). */
const DETECT_CANDLES = 200

/** Total auto-draw overlays a single detect may add — a readable chart beats an exhaustive one.
 *  With the priority ordering, the cap sheds the most confluence-redundant raw levels first. */
const MAX_AUTO_DRAW = 10

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** What the command asked for, in the result's words — so the transcript reads as an act. */
export function describeChartCommand(payload: ChartCommandPayload, venueName: string): string {
  const chart = `the ${payload.symbol} chart on ${venueName}`
  const lines: string[] = []
  if (payload.action === 'open') lines.push(`Opened (or focused) ${chart}.`)
  else lines.push(`Sent to ${chart} (opening it if it was closed):`)
  if (payload.timeframe) lines.push(`- timeframe → ${payload.timeframe}`)
  if (payload.indicatorsMode === 'clear') lines.push('- indicators → cleared')
  else if (payload.indicators) {
    const named = payload.indicators.map((id) => {
      const p = parseIndicatorId(id)
      return p ? `${indicatorLabel(p)} (${id})` : id
    })
    lines.push(`- indicators ${payload.indicatorsMode ?? 'set'} → ${named.join(', ')}`)
    if (payload.indicators.includes('volume')) {
      lines.push('  (volume is built into the chart and always shown)')
    }
  }
  if (payload.chartType) lines.push(`- chart type → ${payload.chartType}`)
  if (payload.navigate) {
    lines.push(
      `- navigate → ${payload.navigate}${payload.time !== undefined ? ` (${new Date(payload.time * 1000).toISOString()})` : ''}`,
    )
  }
  if (payload.configure) {
    const c = payload.configure
    if (c.scaleMode) lines.push(`- price scale → ${c.scaleMode}`)
    if (c.indicator) {
      const p = parseIndicatorId(c.indicator)
      const named = p ? `${indicatorLabel(p)} (${c.indicator})` : c.indicator
      // "hidden" is not "removed" — the distinction the eye toggle exists for.
      if (c.visible !== undefined) {
        lines.push(`- ${named} → ${c.visible ? 'shown' : 'hidden (still on the chart)'}`)
      }
      if (c.color) lines.push(`- ${named} color → ${c.color}`)
      if (c.rangeMin !== undefined && c.rangeMax !== undefined) {
        lines.push(`- ${named} scale → fixed ${c.rangeMin}–${c.rangeMax}`)
      }
      if (c.rangeAuto) lines.push(`- ${named} scale → autoscale`)
      lines.push(
        '  (nothing happens if that indicator is not on the chart — snapshot lists what is)',
      )
    }
  }
  if (payload.drawMode === 'clear') lines.push('- drawings → cleared')
  else if (payload.drawMode === 'remove') {
    lines.push(`- drawing removed → ${payload.drawingId}`)
  } else if (payload.drawing) {
    lines.push(`- drawing added → ${describeChartDrawing(payload.drawing)}`)
    if (!payload.drawing.id) {
      lines.push('  (id auto-assigned as d1, d2, … — action="snapshot" lists drawings with ids)')
    }
  }
  lines.push('The chart in the Trading workspace reflects it — this call returns no market data.')
  return lines.join('\n')
}

/** Drive the trading chart the user sees. Sequential: commands are ordered UI state changes. */
export function createManageChartTool(options: ManageChartToolOptions) {
  return defineAgentTool({
    name: 'manage_chart',
    activeVerb: 'Controlling the chart',
    availability: { requiredCapabilities: ['workbench-ui'] },
    description:
      "Control the live candlestick chart in the user's Trading workspace (UI only — it never reads or trades the " +
      "venue; use market_data for numbers). Every action targets one market's chart tab by symbol (+ optional " +
      'connection_id, defaulting to the public venue) and OPENS/FOCUSES that tab first. action="open" just opens it ' +
      '(optionally also applying timeframe / indicators / chart_type in the same call, e.g. {action:"open", symbol:' +
      '"BTC/USDC:USDC", timeframe:"4h", indicators:["ema:200","rsi:14"]}). action="set_timeframe" needs timeframe ' +
      '(e.g. "15m", "1h", "1d"; must be one the venue offers). action="set_indicators" needs indicators — ' +
      'parameterized specs like "ema:200", "bb:20:2", "macd:12:26:9", "vwap", "supertrend:10:3", "stoch:14:3:3", ' +
      '"atr:14", "obv", "adx:14", or preset aliases like "sma20"/"st"/"dmi" — with ' +
      'indicators_mode "set" (default, replaces), "add", "remove", or "clear". action="set_chart_type" needs ' +
      'chart_type: candles | line | area | bars. action="navigate" needs navigate: to_realtime | to_time (with ' +
      '`time`, unix seconds) | zoom_in | zoom_out | fit. action="draw" draws on the chart: draw_mode "add" ' +
      '(default) with drawing_kind "hline" (needs price), "trendline" (needs time+price and time2+price2), ' +
      '"vline" (needs time) or "marker" (a trade arrow ON the candles — needs time + side buy|sell, optional ' +
      'price/label; use markers to show fills or historical entries/exits), plus optional drawing_id / color / ' +
      'line_style / label; draw_mode "remove" deletes by ' +
      'drawing_id; "clear" removes all. action="configure" changes how the chart READS: with `indicator` (a spec ' +
      'already on the chart) pass visible (hide/show without removing), color (hex), range_min+range_max (pin the ' +
      "indicator pane's scale) or range_auto; and/or scale_mode (linear | log | percentage) for the main price " +
      'scale. action="snapshot" is the READ-BACK: it returns the chart tab\'s actual current state — timeframe, ' +
      'chart type, indicators WITH THEIR COMPUTED VALUES (e.g. rsi:14 = 63.2), drawings, visible range, last ' +
      'candle — without opening or changing anything. Use it to read what the user sees; use market_data for raw ' +
      'OHLCV. action="detect" SCANS the market\'s recent candles (timeframe honoured, default 1h) for ' +
      'support/resistance levels (with touch counts), position in structure, Fibonacci retracement, ' +
      'daily pivot points, round-number magnets, confluence zones (where methods agree), ' +
      'the trend fit, the market regime, a composite ' +
      'Trend/Momentum/Volume signal vote, RSI divergence, ATR volatility with stop-distance references, ' +
      'downside risk (VaR/CVaR + max drawdown), higher-timeframe context (regime/trend + alignment), ' +
      'and candlestick flags — all with numbers, no ' +
      'open chart needed; pass auto_draw=true to also draw the levels/trend on the chart (stable pat-* ids a ' +
      're-detect replaces). The other commands take effect in the UI the user is looking at; their result text ' +
      'confirms what was commanded.',
    inputSchema: manageChartInputSchema,
    executionMode: 'sequential',
    // Commands move the user's view, never durable state (see `manage-chart-class.ts`).
    mutates: false,
    classify: classifyManageChartCall,
    async execute(_toolCallId, input, _signal, _onUpdate, context) {
      const problem = manageChartProblem(input)
      if (problem) return { content: problem, isError: true }

      let conns: MarketDataConnection[]
      try {
        conns = await options.port.listConnections()
      } catch (err) {
        return { content: `Trading is not available: ${errText(err)}`, isError: true }
      }
      // The same default the chart UI itself opens on: the ephemeral public profile.
      const connectionId = input.connection_id ?? publicConnectionId(DEFAULT_PUBLIC_EXCHANGE_ID)
      const target = conns.find((c) => c.id === connectionId)
      if (!target) {
        const opts = conns.map((c) => `${c.name} (${c.id})`).join(', ')
        return {
          content: `No trading connection with id "${connectionId}". Connections: ${opts || '(none)'}.`,
          isError: true,
        }
      }

      const session = context?.session

      // ── detect: answered SERVER-SIDE from service candles; only the optional auto-draw
      // touches the UI (as standard `draw` commands). Works without a mounted chart tab.
      if (input.action === 'detect') {
        if (!options.port.ohlcv) {
          return {
            content:
              'Pattern detection is unavailable in this build — the chart tool has no candle reader wired.',
            isError: true,
          }
        }
        const timeframe = input.timeframe ?? '1h'
        let candles: MarketDataCandle[]
        try {
          candles = await options.port.ohlcv(target.id, input.symbol, timeframe, DETECT_CANDLES)
        } catch (err) {
          return {
            content: `Could not read candles for ${input.symbol} on "${target.name}": ${errText(err)}`,
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
            // Guarded above (an absent reader returns early); the `!` avoids capturing the method
            // into a variable (which the unbound-method lint flags), calling it inline instead.
            const htfCandles = await options.port.ohlcv!(
              target.id,
              input.symbol,
              htf,
              DETECT_CANDLES,
            )
            if (htfCandles.length >= 8) htfCtx = timeframeContext(htfCandles, htf)
          } catch {
            /* the venue does not offer this timeframe — skip the context, never fail detect */
          }
        }

        // Perp positioning + microstructure, best-effort and IN PARALLEL (both are extra venue
        // round-trips; serializing them doubled the added latency). The book snapshot is only
        // fetched when the report will actually print it: compact renders it as detail-only,
        // and the mode sold as "the cheap read" must not pay for a line it omits.
        const wantBook = input.detail !== 'compact' && options.port.orderBook !== undefined
        const [funding, book] = await Promise.all([
          options.port.funding
            ? options.port
                .funding(target.id, input.symbol)
                .then(fundingRead)
                .catch(() => null)
            : Promise.resolve(null),
          wantBook
            ? options.port.orderBook!(target.id, input.symbol, 10)
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
          add(
            true,
            ...renderStructurePosition(structurePosition(report.levels, lastClose), lastClose),
          )
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
          const prioritized = [
            // The structure break as a dashed line at the flipped swing level.
            ...structureBreakDrawPayloads(target.id, input.symbol, structureBreak),
            // The volume Point of Control — the single most-traded price, a strong magnet.
            ...(volProfile
              ? [
                  {
                    action: 'draw' as const,
                    connectionId: target.id,
                    symbol: input.symbol,
                    drawMode: 'add' as const,
                    drawing: {
                      kind: 'hline' as const,
                      id: 'vol-poc',
                      price: volProfile.poc,
                      color: '#e0a458',
                      lineStyle: 'dotted' as const,
                      label: 'POC',
                    },
                  },
                ]
              : []),
            // Session VWAP — the intraday benchmark, a must-see line, drawn high-priority.
            ...(vwap
              ? [
                  {
                    action: 'draw' as const,
                    connectionId: target.id,
                    symbol: input.symbol,
                    drawMode: 'add' as const,
                    drawing: {
                      kind: 'hline' as const,
                      id: 'vwap-mid',
                      price: vwap.vwap,
                      color: '#a78bfa',
                      lineStyle: 'solid' as const,
                      label: 'VWAP',
                    },
                  },
                ]
              : []),
            // The unfilled fair value gaps as shaded demand/supply zones.
            ...fvgDrawPayloads(target.id, input.symbol, fvgs),
            // The unmitigated order blocks — the SMC retest zones, same visual language.
            ...orderBlockDrawPayloads(target.id, input.symbol, orderBlocks),
            // The key fib levels — quiet dashed lines, stable ids, confluence-merged.
            ...(fib ? fibDrawPayloads(target.id, input.symbol, fib) : []),
            // The volume value area as a faint band — the fair-value zone. Ranked below the
            // high-signal overlays so the auto-draw cap self-limits it (shows on a quiet chart,
            // shed on a busy one) rather than adding to the clutter.
            ...(volProfile
              ? [
                  {
                    action: 'draw' as const,
                    connectionId: target.id,
                    symbol: input.symbol,
                    drawMode: 'add' as const,
                    drawing: {
                      kind: 'zone' as const,
                      id: 'vol-va',
                      price1: volProfile.val,
                      price2: volProfile.vah,
                      color: '#e0a458',
                      label: 'Value area',
                    },
                  },
                ]
              : []),
            // Raw pattern S/R + trend last — fills whatever the cap leaves.
            ...detectDrawPayloads(target.id, input.symbol, report),
          ]
          const payloads = prioritized.slice(0, MAX_AUTO_DRAW)
          const omitted = prioritized.length - payloads.length
          if (!session?.emitCommand) {
            lines.push(
              '(auto_draw skipped: no UI command channel in this run — the numbers above are complete)',
            )
          } else if (payloads.length === 0) {
            lines.push('(nothing drawable found — no drawings were added)')
          } else {
            for (const p of payloads) session.emitCommand(TRADING_PLUGIN, TRADING_CHART_CHANNEL, p)
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

      if (!session?.emitCommand) {
        return {
          content:
            'The chart cannot be controlled from this run — no UI command channel is available.',
          isError: true,
        }
      }

      // Batch draw: the agent handed a whole `drawings` array — emit ONE add command per shape in
      // this single tool call (validated already by manageChartProblem), instead of the model
      // calling the tool once per line. Each keeps the caller's id (upsert) or takes a fresh `d<n>`.
      if (input.action === 'draw' && input.drawings !== undefined) {
        const drawings = buildChartDrawings(input)
        for (const drawing of drawings) {
          session.emitCommand(TRADING_PLUGIN, TRADING_CHART_CHANNEL, {
            action: 'draw',
            connectionId: target.id,
            symbol: input.symbol,
            drawMode: 'add',
            drawing,
          })
        }
        return {
          content: drawings.length
            ? `Drew ${drawings.length} shape${drawings.length === 1 ? '' : 's'} on the ${target.name} ${input.symbol} chart — remove via action="draw" draw_mode="remove"/"clear".`
            : 'Nothing drawable in the batch — no drawings were added.',
          details: { connection: target.id, symbol: input.symbol, action: 'draw' },
        }
      }

      const payload = buildChartCommandPayload(input, target.id)
      const details = { connection: target.id, symbol: payload.symbol, action: payload.action }

      if (payload.action === 'snapshot') {
        // READ-BACK round-trip: await the UI sink's reply (correlated by the frame's
        // commandId). The sink answers from its chart-state store without opening or
        // focusing anything — snapshot is read-only by contract.
        if (!session.emitCommandWithReply) {
          return {
            content:
              'Chart state cannot be read from this run — the host has no UI reply channel. ' +
              'The chart itself is unaffected.',
            isError: true,
          }
        }
        const outcome = await session.emitCommandWithReply(
          TRADING_PLUGIN,
          TRADING_CHART_CHANNEL,
          payload,
        )
        if (!outcome.ok) {
          // Honest, non-crashing: a silent UI (tab closed / client offline) is
          // "couldn't look at it", not a defect — mirrors the `browser` tool's notEngaged.
          return {
            content: outcome.noReply
              ? `No reply from the UI — the ${payload.symbol} chart state could not be read ` +
                '(the client may be offline). Nothing was opened or changed. If you need the ' +
                'live chart, open it first with action="open".'
              : `The UI could not produce a chart snapshot: ${outcome.error}`,
            details,
          }
        }
        const snap = parseChartSnapshotResult(outcome.result)
        if (!snap) {
          return { content: 'The UI replied with an unrecognized snapshot shape.', isError: true }
        }
        return {
          content: describeChartSnapshot(snap, target.name),
          details: { ...details, mounted: snap.mounted },
          // A live-state read: when the agent snapshots the same chart again, the
          // older read is superseded in the model context (per-resource key).
          supersedeKey: `trading:chart:${target.id}:${payload.symbol}`,
        }
      }

      session.emitCommand(TRADING_PLUGIN, TRADING_CHART_CHANNEL, payload)
      return {
        content: describeChartCommand(payload, target.name),
        details,
      }
    },
  })
}
