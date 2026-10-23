import { useSyncExternalStore } from 'react'
import { CandlestickChart } from 'lucide-react'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, statusMenuList } from '@localixai/mini-app-sdk/ui'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

import { chartStateStore } from './model/chartStateStore'
import { formatPrice } from './model/formatQuote'
import { normalizeChartPayload, openTradingChartTab, tradingChartTabId } from './model/openTab'

const CHART_KIND = 'trading:chart'
const WORKSPACE_KIND = 'trading:workspace'

interface WatchedMarket {
  /** The market's chart key — what the chart publishes its state under. */
  key: string
  connectionId: string
  symbol: string
  exchangeId?: string
  name?: string
  connectionName?: string
  credentialed?: boolean
  last?: number
}

/**
 * The market you are watching, and what it last traded at.
 *
 * Charts are the one mini app surface whose value expires: a price is about NOW, and a chart tab
 * behind the chat is a chart you are not looking at. This is the case the seam's `metrics` shape
 * was designed for — a number that ticks, in `tabular-nums`, without shoving its neighbours
 * sideways as digits change.
 *
 * The number is FREE. The mounted chart already publishes its newest bar into `chartStateStore`
 * from the subscription it runs anyway; this reads the same store. What it does not do is read it
 * at the market's pace — the store coalesces its announcements to once a second, which is the
 * right resolution outside a chart and keeps a titlebar off the critical path of a candle push.
 *
 * Every action opens IN `sessionId`, the chat this titlebar belongs to, and lists only THAT chat's
 * charts. A chart is a session tab, and the workspace snapshot holds every chat's tabs with no
 * way (nor any business) for a mini app to tell whose they are — reading it, chat A's titlebar
 * listed chat B's markets. So the list comes from the chart-state store's entries for this chat,
 * which each mounted chart publishes with what reopens it; a click opens or focuses that market's
 * chart in this chat. No chat, no item: nothing to open in.
 *
 * No chart open, no item: this mini app is silent until you ask it something.
 */
export function useTradingStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()
  useSyncExternalStore(chartStateStore.subscribe, chartStateStore.version, chartStateStore.version)

  const charts: WatchedMarket[] = sessionId
    ? chartStateStore
        .ofSession(sessionId)
        .flatMap(([key, state]) =>
          state.mounted && state.market
            ? [{ ...state.market, key, last: state.lastCandle?.close }]
            : [],
        )
    : []

  if (!sessionId || charts.length === 0) return null

  // The focused tab is one of the chat on screen; its market names the featured row when it is one
  // of THIS chat's charts.
  const focused = workspace.focusedId ? workspace.items[workspace.focusedId] : undefined
  const focusedKey =
    focused?.kind === CHART_KIND
      ? tradingChartTabId(
          normalizeChartPayload(focused.payload).connectionId,
          typeof focused.payload?.symbol === 'string' ? focused.payload.symbol : focused.title,
        )
      : null

  // The chart on screen when there is one, else simply the first — a person with several open is
  // told which one the number belongs to by the `text`, so any stable pick reads honestly.
  const featured = charts.find((chart) => chart.key === focusedKey) ?? charts[0]!
  const active = charts.some((chart) => chart.key === focusedKey)

  const openChart = (chart: WatchedMarket) =>
    openTradingChartTab(sessionId, {
      connectionId: chart.connectionId,
      symbol: chart.symbol,
      exchangeId: chart.exchangeId,
      name: chart.name,
      connectionName: chart.connectionName,
      credentialed: chart.credentialed,
    })

  const openWorkspace = () =>
    miniAppWorkspace.openWorkItem({
      workKind: WORKSPACE_KIND,
      id: WORKSPACE_KIND,
      title: 'Trading',
      scope: sessionId,
    })

  return {
    label:
      featured.last === undefined
        ? `Trading — ${featured.symbol}`
        : `Trading — ${featured.symbol} at ${formatPrice(featured.last)}`,
    Icon: CandlestickChart,
    text: featured.symbol,
    // A metric rather than part of `text`: the host owns the alignment that stops a ticking
    // number from jittering, and it is not this mini app's business how wide a digit is.
    ...(featured.last === undefined
      ? {}
      : {
          metrics: [
            { value: formatPrice(featured.last), label: `${featured.symbol} last traded price` },
          ],
        }),
    active,
    onClick: () => openChart(featured),
    menu: [
      {
        id: 'workspace',
        label: 'Open Trading',
        icon: CandlestickChart,
        onSelect: openWorkspace,
      },
      { separator: true },
      ...statusMenuList({
        header: 'Open charts',
        items: charts,
        row: (chart) => ({
          id: `chart:${chart.key}`,
          label: chart.symbol,
          // Prices in their own column, so several markets can be read down rather than across —
          // which is the only reason to have more than one chart open.
          ...(chart.last === undefined ? {} : { hint: formatPrice(chart.last) }),
          selected: chart.key === featured.key,
          onSelect: () => openChart(chart),
        }),
        onOverflow: openWorkspace,
        overflowLabel: (hidden) => `${hidden} more charts…`,
      }),
    ],
  }
}
