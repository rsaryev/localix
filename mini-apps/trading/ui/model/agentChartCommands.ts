import { miniAppCommandBus, type MiniAppCommandEvent } from '@localixai/mini-app-sdk/ui/commands'
import {
  TRADING_CHART_CHANNEL,
  TRADING_MINI_APP,
  parseChartCommandPayload,
  type ChartCommandPayload,
} from '../../backend/chart-command'
import { publicExchangeId } from '../../backend/public-connection'
import { chartControlBus, type ChartControlCommand } from './chartControlBus'
import { buildChartSnapshot } from './chartSnapshot'
import { openTradingChartTab, tradingChartTabId, type OpenChartArgs } from './openTab'

/**
 * The trading UI's SINK for `manage_chart` tool commands. The backend tool emits ONE payload as a
 * typed `mini-app.command` stream frame (`session.emitCommand` → `mini-app.command` →
 * `miniAppCommandBus`, keyed `trading`/`chart`); this module opens/focuses the market's chart tab
 * and forwards the payload's parts onto `chartControlBus` for that tab id, where TradingChartTab
 * (timeframe) and ChartCanvas (indicators / chart type / navigation) subscribe. Route B upgrades
 * over the old `ui.data` path: non-coalescing (two back-to-back commands both land), replayable
 * (a reconnecting client catches up; the bus dedups by commandId), and session-aware.
 *
 * Placement policy: the chart opens in the workspace of the session whose agent issued the
 * command (`event.sessionId`). It used to open only for the ACTIVE session, because a chart was
 * then one global tab and opening it for a background agent would have put it in front of the
 * chat the person was reading. A chart is now a session tab, so a background agent's chart lands
 * in ITS chat — hidden until that chat is shown, never in front of another — instead of being
 * dropped with the bus's ~5 s replay buffer. The state changes go to `chartControlBus` under that
 * SAME chat and the market, and a snapshot reads that chat's chart: keyed by market alone, one
 * chat's agent moved — and read — another chat's chart of the same market.
 */

export interface ChartCommandPlan {
  /** The tab to open/focus FIRST — targeting a chart means standing in front of it. */
  open: OpenChartArgs
  /** The chartControlBus key the commands are addressed to. */
  tabId: string
  commands: ChartControlCommand[]
}

/** Decompose one wire payload into the open + the per-concern commands. Pure. */
export function planChartCommand(payload: ChartCommandPayload): ChartCommandPlan {
  const exchangeId = publicExchangeId(payload.connectionId) ?? undefined
  const venue = exchangeId ?? payload.connectionId
  const commands: ChartControlCommand[] = []
  if (payload.timeframe) commands.push({ type: 'set_timeframe', timeframe: payload.timeframe })
  if (payload.indicators || payload.indicatorsMode === 'clear') {
    commands.push({
      type: 'set_indicators',
      mode: payload.indicatorsMode ?? 'set',
      ids: payload.indicators ?? [],
    })
  }
  if (payload.chartType) commands.push({ type: 'set_chart_type', chartType: payload.chartType })
  if (payload.drawMode) {
    commands.push({
      type: 'draw',
      mode: payload.drawMode,
      ...(payload.drawing ? { drawing: payload.drawing } : {}),
      ...(payload.drawingId ? { id: payload.drawingId } : {}),
    })
  }
  if (payload.navigate) {
    commands.push(
      payload.navigate === 'to_time'
        ? { type: 'navigate', op: 'to_time', time: payload.time ?? 0 }
        : { type: 'navigate', op: payload.navigate },
    )
  }
  if (payload.configure) {
    const c = payload.configure
    // The scale mode is the CHART's, the rest is one indicator's — a single `configure` may
    // legitimately carry both, so they decompose into two independent commands.
    if (c.scaleMode) commands.push({ type: 'set_scale_mode', mode: c.scaleMode })
    if (c.indicator) {
      const patch: Extract<ChartControlCommand, { type: 'configure_indicator' }>['patch'] = {
        ...(c.visible !== undefined ? { hidden: !c.visible } : {}),
        ...(c.color !== undefined ? { color: c.color } : {}),
        ...(c.rangeMin !== undefined && c.rangeMax !== undefined
          ? { range: { min: c.rangeMin, max: c.rangeMax } }
          : {}),
        ...(c.rangeAuto !== undefined ? { rangeAuto: c.rangeAuto } : {}),
      }
      // An indicator named with no visual change (scale-mode-only call) is nothing to patch.
      if (Object.keys(patch).length > 0) {
        commands.push({ type: 'configure_indicator', id: c.indicator, patch })
      }
    }
  }
  return {
    open: {
      connectionId: payload.connectionId,
      symbol: payload.symbol,
      exchangeId,
      name: `${payload.symbol} · ${venue}`,
    },
    tabId: tradingChartTabId(payload.connectionId, payload.symbol),
    commands,
  }
}

/**
 * Apply one command event: parse (drop malformed frames silently — this sits on the live
 * stream path and must never throw into it), plan, then open/focus the chart in the issuing
 * session before publishing the state changes. Exported for tests.
 */
export function handleChartCommandEvent(event: MiniAppCommandEvent): void {
  const payload = parseChartCommandPayload(event.payload)
  if (!payload) return
  if (payload.action === 'snapshot') {
    // READ-ONLY round-trip: answer from the chart-state store (or remembered prefs
    // when the tab was never opened) and return BEFORE the open/plan path — a
    // snapshot must never open, focus, or change anything, active session or not.
    const tabId = tradingChartTabId(payload.connectionId, payload.symbol)
    event.reply?.({
      ok: true,
      result: buildChartSnapshot(event.sessionId, tabId, payload.connectionId, payload.symbol),
    })
    return
  }
  const plan = planChartCommand(payload)
  openTradingChartTab(event.sessionId, plan.open)
  for (const command of plan.commands) {
    chartControlBus.publish(event.sessionId, plan.tabId, command)
  }
}

let initialized = false

/** Wire the sink once (called from `registerUi`). */
export function initAgentChartCommands(): void {
  if (initialized) return
  initialized = true
  miniAppCommandBus.register(TRADING_MINI_APP, TRADING_CHART_CHANNEL, handleChartCommandEvent)
}
