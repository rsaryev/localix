/**
 * Last-known live state of each chart, keyed by its CHAT and the chart tab id
 * (`tradingChartTabId(connectionId, symbol)` — identity lives in the key, like
 * `chartControlBus`) — the QUERY side of agent chart control.
 *
 * Keyed by chat because a chart is a session tab: two chats can each hold BTC, and keyed by
 * market alone their timeframes, viewports and last bars overwrote each other, so one chat's
 * agent read — and its titlebar listed — the other chat's chart. The market's PERSISTED prefs
 * (drawings, indicators, chart type) stay keyed by market; only this live state is per chat. The mounted chart PUBLISHES into it
 * from the subscriptions it already runs (timeframe choice, chart-type / indicator effects, the
 * visible-range handler, the candle push), so answering a `snapshot` command is a plain Map read —
 * no request/response reaching into React internals, mirroring how `chartControlBus` kept the
 * command side out of React state.
 *
 * `patch` is a plain upsert with `mounted` defaulting to false: ChartCanvas (a child, whose
 * effects run FIRST on mount) may publish before TradingChartTab declares the tab mounted, and
 * neither order may lose a write. Entries survive unmount as `mounted: false` (the last-known
 * state is still the honest "what it would reopen with"); the map is capped so a long-lived page
 * can't grow one entry per market ever visited.
 */

import type { ChartTypeToken } from '../../backend/chart-command'
import type { ChartDrawing } from '../../backend/chart-drawing'
import type { ChartScaleMode } from './indicatorPrefs'
import type { OpenChartArgs } from './openTab'

export interface ChartTabState {
  /** True while the tab is on screen (owned by TradingChartTab's mount effect). */
  mounted: boolean
  /** What reopens this chart — published by the mounted tab, so a reader with only the store (the
   *  titlebar) can list and focus this chat's charts without decoding the host's tab ids. */
  market?: OpenChartArgs
  timeframe?: string
  chartType?: ChartTypeToken
  /** Active indicators as canonical ids (`ema:200`, `bb:20:2`). */
  indicators?: string[]
  /** The subset of `indicators` currently hidden (legend eye) — still mounted, not drawn. */
  hiddenIndicators?: string[]
  /** Latest COMPUTED value per indicator series (`rsi:14` → `{line: 63.2}`), fed by the
   *  chart's own per-tick compute — what the agent's snapshot reads numbers from. */
  indicatorValues?: Record<string, Record<string, number>>
  /** The main price scale's mode. */
  scaleMode?: ChartScaleMode
  /** Drawings on the chart, each with its assigned id. */
  drawings?: ChartDrawing[]
  /** Visible time range in unix seconds. */
  visibleRange?: { from: number; to: number }
  /** Newest bar the chart holds — unix seconds + close. */
  lastCandle?: { time: number; close: number }
}

const MAX_ENTRIES = 64

const states = new Map<string, ChartTabState>()

/** The entry key: chat, then the chart tab id. NUL never appears in either. */
const SEPARATOR = '\u0000'
const keyOf = (sessionId: string, tabId: string) => `${sessionId}${SEPARATOR}${tabId}`

/**
 * The floor between announcements, in ms.
 *
 * `patch` runs on every candle push — the fastest writer in this mini app. That is the right rate
 * for a chart and the wrong rate for anything outside it: a subscriber that re-rendered per tick
 * would drag whatever it lives in along at the market's pace. The chart itself does not use this
 * channel (it owns the data it publishes), so nobody is slowed down by the coalescing, and a
 * second-resolution price is what a reader outside the chart wants anyway.
 */
const NOTIFY_FLOOR_MS = 1000

const listeners = new Set<() => void>()
let version = 0
let pending: ReturnType<typeof setTimeout> | null = null
let lastNotifiedAt = 0

function announce(): void {
  if (listeners.size === 0 || pending) return
  const wait = Math.max(0, NOTIFY_FLOOR_MS - (Date.now() - lastNotifiedAt))
  pending = setTimeout(() => {
    pending = null
    lastNotifiedAt = Date.now()
    version += 1
    for (const listener of Array.from(listeners)) listener()
  }, wait)
}

export const chartStateStore = {
  /** Merge a partial update into the chat's chart state (upsert — first write creates it). */
  patch(sessionId: string, tabId: string, partial: Partial<ChartTabState>): void {
    const key = keyOf(sessionId, tabId)
    const current = states.get(key)
    if (!current && states.size >= MAX_ENTRIES) {
      const oldest = states.keys().next().value
      if (oldest !== undefined) states.delete(oldest)
    }
    states.set(key, { mounted: false, ...current, ...partial })
    announce()
  },

  /** Keep the last-known state but record that the tab left the screen. */
  markUnmounted(sessionId: string, tabId: string): void {
    const key = keyOf(sessionId, tabId)
    const current = states.get(key)
    if (current) states.set(key, { ...current, mounted: false })
    announce()
  },

  get(sessionId: string, tabId: string): ChartTabState | undefined {
    return states.get(keyOf(sessionId, tabId))
  },

  /** One chat's charts as `[tabId, state]`, newest write last — for a reader with no tab id in
   *  hand. Never another chat's: that is the whole point of the key. */
  ofSession(sessionId: string): ReadonlyArray<readonly [string, ChartTabState]> {
    const prefix = `${sessionId}${SEPARATOR}`
    return Array.from(states.entries()).flatMap(([key, state]) =>
      key.startsWith(prefix) ? [[key.slice(prefix.length), state] as const] : [],
    )
  },

  /**
   * Listen for movement, at most once a second. Returns the unsubscribe.
   *
   * A counter is the snapshot rather than the map: `useSyncExternalStore` compares by identity,
   * and a Map mutated in place is its own previous value.
   *
   * Arrow properties, not method shorthand: both are handed STRAIGHT to `useSyncExternalStore`,
   * which calls them detached from the store. Shorthand would make that an unbound-method lint
   * error at every call site rather than a decision made once, here.
   */
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  version: (): number => version,

  /** Test seam: forget everything. */
  _clear(): void {
    states.clear()
    if (pending) {
      clearTimeout(pending)
      pending = null
    }
    lastNotifiedAt = 0
  },
}
