import { defineAgentTool } from '@localixai/agent/agents'
import type { MarketDataConnection } from './market-data-port'
import { TRADING_CHART_CHANNEL, TRADING_MINI_APP, type ChartCommandPayload } from './chart-command'
import { classifyManageChartCall } from './manage-chart-class'
import { describeChartDrawing } from './chart-drawing'
import { describeChartSnapshot, parseChartSnapshotResult } from './chart-snapshot'
import { indicatorLabel, parseIndicatorId } from './indicator-spec'
import {
  buildChartCommandPayload,
  manageChartInputSchema,
  manageChartProblem,
} from './manage-chart-schema'
import { buildChartDrawings } from './manage-chart-draw'
import { type ChartDetectPort, runChartDetect } from './manage-chart-detect'
import { DEFAULT_PUBLIC_EXCHANGE_ID, publicConnectionId } from './public-connection'

/**
 * `manage_chart` — the agent's hands on the Trading workspace's chart. ONE tool, one action enum
 * (open / set_timeframe / set_indicators / set_chart_type / navigate), mirroring `manage_orders`.
 *
 * Route B (typed command stream): it does not touch the venue at all — it validates, resolves the
 * connection, and emits ONE command payload as a `plugin.command` stream frame
 * (`session.emitCommand` → `plugin.command` → miniAppCommandBus), keyed `trading`/`chart`.
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
  port: ChartDetectPort & {
    listConnections(): Promise<MarketDataConnection[]>
  }
}

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

      if (input.action === 'detect') return runChartDetect(options.port, target, input, session)

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
          session.emitCommand(TRADING_MINI_APP, TRADING_CHART_CHANNEL, {
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
          TRADING_MINI_APP,
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

      session.emitCommand(TRADING_MINI_APP, TRADING_CHART_CHANNEL, payload)
      return {
        content: describeChartCommand(payload, target.name),
        details,
      }
    },
  })
}
