/**
 * The trading titlebar lists only ITS chat's charts.
 *
 * It used to read every chart tab in the workspace snapshot, which holds every chat's tabs: chat
 * A's titlebar listed — and featured the price of — chat B's markets. The list now comes from the
 * chart-state store's entries for the item's own chat.
 */

import { afterEach, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'

import { chartStateStore } from './model/chartStateStore'
import { useTradingStatusItem } from './statusItem'

afterEach(() => chartStateStore._clear())

function itemFor(sessionId: string | null): StatusItemState | null {
  let seen: StatusItemState | null = null
  const capture = (item: StatusItemState | null) => {
    seen = item
  }
  function Harness({ onItem }: { onItem: (item: StatusItemState | null) => void }) {
    onItem(useTradingStatusItem(sessionId))
    return null
  }
  renderToStaticMarkup(<Harness onItem={capture} />)
  return seen
}

const market = (symbol: string) => ({ connectionId: 'public:hyperliquid', symbol })

test("a chat's titlebar lists its own charts and never another chat's", () => {
  chartStateStore.patch('chat-a', 'btc', { mounted: true, market: market('BTC') })
  chartStateStore.patch('chat-b', 'eth', { mounted: true, market: market('ETH') })
  // A closed chart of this chat is last-known state, not an open chart.
  chartStateStore.patch('chat-a', 'sol', { mounted: false, market: market('SOL') })

  expect(itemFor('chat-a')?.text).toBe('BTC')
  const labels = JSON.stringify(itemFor('chat-a')?.menu)
  expect(labels).toContain('"BTC"')
  expect(labels).not.toContain('"ETH"')
  expect(labels).not.toContain('"SOL"')
})

test('a chat with no chart of its own, or no chat at all, has no item', () => {
  chartStateStore.patch('chat-b', 'eth', { mounted: true, market: market('ETH') })
  expect(itemFor('chat-a')).toBeNull()
  expect(itemFor(null)).toBeNull()
})
