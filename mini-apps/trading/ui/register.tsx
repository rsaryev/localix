import { lazy, Suspense } from 'react'
import {
  Activity,
  ArrowLeftRight,
  BookOpenText,
  CandlestickChart,
  Gauge,
  History,
  Landmark,
  LayoutGrid,
  LineChart,
  ListOrdered,
  Percent,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import {
  localixUriNamespace,
  type MiniAppUiHost,
  type PublishMessageContext,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { parseTradeUri } from '../backend/uri'
import { normalizeChartPayload, tradingChartTabId } from './model/openTab'
import { useTradingStatusItem } from './statusItem'
import { initAgentChartCommands } from './model/agentChartCommands'
import { normalizeTradingArea, saveTradingArea } from './model/tradingArea'
import { chartToMessageBinding, technicalsToMessageBinding } from './model/tabBindings'

/**
 * UI registration for the bundled Trading subsystem. Contributes one root Trading Workspace
 * plus its chart/technicals work-item kinds through the {@link MiniAppUiHost}
 * registration façade (the mini app SDK contract). It is discovered + invoked
 * generically by `shared/contrib/discover.ts`.
 */

const TradingChartTab = lazy(() =>
  import('./TradingChartTab').then((m) => ({ default: m.TradingChartTab })),
)

const TechnicalsTab = lazy(() =>
  import('./TechnicalsTab').then((m) => ({ default: m.TechnicalsTab })),
)

const TradingWorkspaceLazy = lazy(() =>
  import('./TradingWorkspace').then((m) => ({ default: m.TradingWorkspace })),
)

/**
 * The workspace and a chart are SESSION tabs: a chart asks its chat's agent (book, tape and carry
 * clicks, the analysis wizard), and the workspace opens charts. As global tabs they followed the
 * chat on screen, so a chart kept open for chat A put its question into chat B's composer. Each
 * body acts for the chat its tab belongs to (`useWorkItemSessionId`); with none it shows nothing.
 * The technicals page reads public market data only and stays an app-level tab.
 */
function TradingWorkspaceBody({ item, visible }: { item: WorkItemLike; visible: boolean }) {
  const sessionId = useWorkItemSessionId()
  const requestedArea =
    typeof item.payload?.area === 'string' ? normalizeTradingArea(item.payload.area) : undefined
  if (!sessionId) return <EmptyHint>Open Trading from a chat.</EmptyHint>
  return (
    <Suspense fallback={<LoadingHint>Opening Trading Workspace…</LoadingHint>}>
      <TradingWorkspaceLazy sessionId={sessionId} requestedArea={requestedArea} active={visible} />
    </Suspense>
  )
}

/** Adapt the generic WorkItem body props to the chart tab's own props (reads `payload`).
 *  The payload is read through `normalizeChartPayload` — the SAME helper the drag-ref uses —
 *  so what the tab charts and what its ref names can never diverge: a payload without
 *  the `credentialed` claim charts the venue's public profile on BOTH surfaces, and only an
 *  explicitly-`credentialed` payload keeps account context. */
function TradingChartBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  const source = normalizeChartPayload(item.payload)
  if (!sessionId) return <EmptyHint>Open this chart from a chat.</EmptyHint>
  return (
    <TradingChartTab
      key={item.id}
      sessionId={sessionId}
      connectionId={source.connectionId}
      symbol={(item.payload?.symbol as string) ?? item.title}
      exchangeId={source.exchangeId}
      name={(item.payload?.name as string) ?? item.title}
      connectionName={item.payload?.connectionName as string | undefined}
      credentialed={source.credentialed}
      active={visible}
      publishMessageContext={publishMessageContext}
    />
  )
}

/** Adapt the generic WorkItem body to the technicals page (same normalization as the chart). */
function TradingTechnicalsBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const source = normalizeChartPayload(item.payload)
  return (
    <TechnicalsTab
      key={item.id}
      connectionId={source.connectionId}
      symbol={(item.payload?.symbol as string) ?? item.title}
      active={visible}
      publishMessageContext={publishMessageContext}
    />
  )
}

let registered = false

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  // The `manage_chart` tool's UI sink: `mini-app.command` frames keyed `trading`/`chart`
  // open/focus the market's chart tab and forward the command onto chartControlBus (see
  // agentChartCommands.ts for the placement policy — a chart opens in the issuing chat).
  initAgentChartCommands()

  host.workItems.register({
    kind: 'trading:workspace',
    Component: TradingWorkspaceBody,
    Icon: LineChart,
    restorable: true,
    agentContext: {
      description: 'Trading markets, charts, and technical analysis workspace.',
      tools: ['market_data', 'manage_chart'],
      nextSteps: [
        'Inspect the selected market with market_data.',
        'Open or adjust the relevant chart with manage_chart.',
      ],
    },
  })

  host.workItems.register({
    kind: 'trading:chart',
    Component: TradingChartBody,
    Icon: CandlestickChart,
    restorable: true,
    toMessageBinding: chartToMessageBinding,
    agentContext: {
      description: 'Live market chart with the selected symbol, venue, and timeframe.',
      tools: ['market_data', 'manage_chart'],
      nextSteps: [
        'Read current market data before interpreting the chart.',
        'Use manage_chart for requested symbol, timeframe, or indicator changes.',
      ],
    },
    // Grouped by the NORMALIZED connection — the one the tab actually charts — so a tab without
    // the claim groups with its venue's public siblings, not with a connection it no longer shows.
    siblingGroupKey: (item) =>
      item.payload?.connectionId || item.payload?.exchangeId
        ? `trading:chart:${normalizeChartPayload(item.payload).connectionId}`
        : null,
  })

  // The technicals page — its own tab, opened from the chart's control
  // cluster. Grouped with its market's chart siblings so the grid keeps them together.
  host.workItems.register({
    kind: 'trading:technicals',
    Component: TradingTechnicalsBody,
    Icon: Gauge,
    restorable: true,
    scope: 'global',
    toMessageBinding: technicalsToMessageBinding,
    agentContext: {
      description: 'Technical indicators for the selected market and timeframe.',
      tools: ['market_data', 'manage_chart'],
      nextSteps: [
        'Confirm current market data and timeframe.',
        'Explain the visible indicators without treating them as guaranteed outcomes.',
      ],
    },
    siblingGroupKey: (item) =>
      item.payload?.connectionId || item.payload?.exchangeId
        ? `trading:chart:${normalizeChartPayload(item.payload).connectionId}`
        : null,
  })

  // The watched market's last price in the titlebar — a chart behind the chat is a chart you
  // are not looking at, and a price is about now.
  host.statusItems.register({
    id: 'trading:market',
    placement: 'titlebar',
    useItem: useTradingStatusItem,
  })

  host.railViewlets.register({
    kind: 'trading:workspace',
    title: 'Trading',
    label: 'Trading Workspace — markets, charts & trading',
    defaultArea: 'overflow',
    keywords: [
      'workspace',
      'trading',
      'exchange',
      'markets',
      'chart',
      'candles',
      'order book',
      'crypto',
      'ccxt',
      'hyperliquid',
      'paper',
    ],
    Icon: LineChart,
  })

  // Global search: the Trading result glyph + how a `localix://resource/trade/<conn>/markets/<sym>` hit
  // opens its chart tab (via the SAME `tradingChartTabId` formula the sidebar uses).
  host.search.register({
    id: 'trading:search',
    scope: {
      label: 'Trading',
      prefix: 'trade',
      aliases: ['market', 'exchange'],
      icon: 'market',
      lazy: true,
      placeholder: 'Search markets…',
    },
    icons: { market: CandlestickChart, exchange: Landmark },
  })
  host.anchors.register({
    id: 'trading:anchor',
    namespaces: ['trade'],
    icons: {
      exchange: Landmark,
      trading: Landmark,
      markets: LayoutGrid,
      market: CandlestickChart,
      candles: CandlestickChart,
      orderbook: BookOpenText,
      trades: ArrowLeftRight,
      ticker: Activity,
      positions: TrendingUp,
      balance: Wallet,
      orders: ListOrdered,
      fills: Receipt,
      history: History,
      funding: Percent,
      technicals: Gauge,
    },
    resolve: (id) => {
      const node = parseTradeUri(id)
      if (node && (node.kind === 'market' || node.kind === 'marketLeaf')) {
        return {
          kind: 'work-item',
          workKind: 'trading:chart',
          id: tradingChartTabId(node.connectionId, node.symbol),
          title: node.symbol,
          payload: { connectionId: node.connectionId, symbol: node.symbol },
        }
      }
      if (localixUriNamespace(id) !== 'trade') return null
      saveTradingArea('markets')
      return {
        kind: 'work-item',
        workKind: 'trading:workspace',
        id: 'trading:workspace',
        title: 'Trading',
        payload: { area: 'markets' },
      }
    },
  })
}
