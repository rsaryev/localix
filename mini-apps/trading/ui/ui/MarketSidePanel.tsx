import { memo, useCallback, useMemo, useState } from 'react'
import type { Market, PrecisionMode } from '../../backend/contracts'
import { buildTradeUri } from '../../backend/uri'
import { TabPanel, TabStrip, useTabPanelIds, type StripTabItem } from '@localixai/kit/tabs'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { marketTabLabel, marketTabLeaf } from '../model/tradeRefs'
import { OrderBook } from './OrderBook'
import { TradesTape } from './TradesTape'

type SidePanelTab = 'book' | 'trades'

/** Book and tape — the two reads a narrow price column is for. */
const MARKET_TABS: ReadonlyArray<StripTabItem<SidePanelTab>> = [
  { id: 'book', label: 'Book', title: 'Order book' },
  { id: 'trades', label: 'Tape', title: 'Recent trades' },
]

/**
 * The chart's right-hand market column: the order book and the public-trades tape as sibling
 * tabs. Both stay mounted and are toggled with `hidden` so their live streams keep flowing.
 *
 * Memoized — every prop is stable per market, so the chart tab's ticker/candle re-renders never
 * cascade into the ladder and the tape.
 */
export const MarketSidePanel = memo(function MarketSidePanel({
  connectionId,
  symbol,
  market,
  precisionMode,
  bookEnabled,
}: {
  connectionId: string
  symbol: string
  market: Market | null
  precisionMode: PrecisionMode
  /** Whether the venue reports an order book (`capabilities.orderBook`). */
  bookEnabled: boolean
}) {
  const [activeTab, setTab] = useState<SidePanelTab>('book')
  const tabIds = useTabPanelIds('market-data')
  const tabItems = useMemo(
    () =>
      MARKET_TABS.map((item) => ({
        ...item,
        ...tabIds.item(item.id),
      })),
    [tabIds],
  )

  // Drag a tab into the composer to link what it shows — always the live address of this
  // market's leaf, never a snapshot.
  const onTabDragStart = useCallback(
    (id: SidePanelTab, e: React.DragEvent) => {
      setMessageBindingDrag(
        e.dataTransfer,
        createMessageBindingDraft(
          'resource',
          buildTradeUri({ kind: 'marketLeaf', connectionId, symbol, leaf: marketTabLeaf(id) }),
          marketTabLabel(id, symbol),
        ),
      )
    },
    [connectionId, symbol],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip
        items={tabItems}
        activeId={activeTab}
        onChange={setTab}
        onItemDragStart={onTabDragStart}
        variant="compact"
        aria-label="Market data"
      />
      <TabPanel
        id={tabIds.panelId('book')}
        aria-labelledby={tabIds.tabId('book')}
        active={activeTab === 'book'}
        className="flex min-h-0 flex-1 flex-col"
      >
        <OrderBook
          connectionId={connectionId}
          symbol={symbol}
          market={market}
          precisionMode={precisionMode}
          enabled={bookEnabled}
        />
      </TabPanel>
      <TabPanel
        id={tabIds.panelId('trades')}
        aria-labelledby={tabIds.tabId('trades')}
        active={activeTab === 'trades'}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TradesTape
          connectionId={connectionId}
          symbol={symbol}
          market={market}
          precisionMode={precisionMode}
        />
      </TabPanel>
    </div>
  )
})
