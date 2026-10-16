import type { ChartTypeToken, IndicatorMode, NavigateOp } from '../../backend/chart-command'
import type { ChartDrawMode, ChartDrawingSpec } from '../../backend/chart-drawing'
import type { ChartScaleMode, IndicatorRange } from './indicatorPrefs'

/**
 * Singleton pub/sub for agent-driven chart control, keyed by the CHAT and the chart tab id
 * (`tradingChartTabId(connectionId, symbol)`). The chat is in the key because a chart is a session
 * tab: keyed by market alone, chat A's agent setting BTC's timeframe also moved chat B's BTC chart,
 * kept warm in the background. Mirrors `previewControlBus`
 * (apps/ui/src/shared) — transient commands, never routed through React state or a store.
 *
 * One twist those buses don't need: a command usually arrives TOGETHER with the open of its tab
 * (the sink opens, then publishes), so the subscriber does not exist yet — the tab is lazy-loaded
 * and mounts a commit later. Commands published to a key with NO listeners are therefore held in a
 * short-lived replay buffer and handed to each subscriber that arrives within the TTL. Replay is
 * non-destructive because TWO listeners share a key (TradingChartTab handles the timeframe,
 * ChartCanvas the rest) and each must see the batch; commands are idempotent state-setters, so a
 * duplicate delivery is harmless by design.
 */

export type ChartControlCommand =
  | { type: 'set_timeframe'; timeframe: string }
  | { type: 'set_indicators'; mode: IndicatorMode; ids: string[] }
  | { type: 'set_chart_type'; chartType: ChartTypeToken }
  | { type: 'navigate'; op: Exclude<NavigateOp, 'to_time'> }
  | { type: 'navigate'; op: 'to_time'; time: number }
  | { type: 'draw'; mode: ChartDrawMode; drawing?: ChartDrawingSpec; id?: string }
  /** Per-indicator visual overrides (visibility / color / fixed range) — `patchIndicatorPref`'s
   *  vocabulary, applied to the canonical id (which must already be active). */
  | {
      type: 'configure_indicator'
      id: string
      patch: {
        hidden?: boolean
        color?: string | null
        range?: IndicatorRange | null
        rangeAuto?: boolean
      }
    }
  | { type: 'set_scale_mode'; mode: ChartScaleMode }

type Listener = (command: ChartControlCommand) => void

const listeners = new Map<string, Set<Listener>>()

interface Buffered {
  command: ChartControlCommand
  at: number
}

/** How long an undelivered command waits for its tab to mount. Generous against a slow lazy
 *  chunk, short enough that a tab opened minutes later doesn't replay a stale gesture. */
const REPLAY_TTL_MS = 5_000
const MAX_BUFFERED = 16

const buffered = new Map<string, Buffered[]>()

function fresh(entries: Buffered[] | undefined, now: number): Buffered[] {
  return (entries ?? []).filter((e) => now - e.at <= REPLAY_TTL_MS)
}

/** The listener / buffer key: chat, then the chart tab id. NUL never appears in either. */
const keyOf = (sessionId: string, tabId: string) => `${sessionId}\u0000${tabId}`

export const chartControlBus = {
  subscribe(sessionId: string, chartTabId: string, listener: Listener): () => void {
    const tabId = keyOf(sessionId, chartTabId)
    let set = listeners.get(tabId)
    if (!set) {
      set = new Set()
      listeners.set(tabId, set)
    }
    set.add(listener)
    // Replay what arrived before this subscriber, WITHOUT consuming it — the key's other
    // listener (canvas vs tab) mounts in the same commit and needs the same batch.
    const now = Date.now()
    const pending = fresh(buffered.get(tabId), now)
    if (pending.length > 0) buffered.set(tabId, pending)
    else buffered.delete(tabId)
    for (const entry of pending) {
      try {
        listener(entry.command)
      } catch {
        /* never let one subscriber break the bus */
      }
    }
    return () => {
      const current = listeners.get(tabId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listeners.delete(tabId)
    }
  },

  publish(sessionId: string, chartTabId: string, command: ChartControlCommand): void {
    const tabId = keyOf(sessionId, chartTabId)
    const set = listeners.get(tabId)
    if (set && set.size > 0) {
      // Snapshot: a listener may (un)subscribe from inside its handler.
      for (const listener of Array.from(set)) {
        try {
          listener(command)
        } catch {
          /* never let one subscriber break the fan-out */
        }
      }
      return
    }
    const now = Date.now()
    const pending = fresh(buffered.get(tabId), now)
    pending.push({ command, at: now })
    buffered.set(tabId, pending.slice(-MAX_BUFFERED))
  },

  /** Test seam: forget everything (listeners persist; only the replay buffer clears). */
  _clearBuffered(): void {
    buffered.clear()
  },
}
