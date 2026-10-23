import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import type { Market } from '../../backend/contracts'
import { acceptedDragKind, registerDom } from '@localixai/kit/testing'
import {
  MESSAGE_BINDING_MIME,
  composerDropHint,
  readMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const MARKET: Market = {
  symbol: 'BTC/USDC:USDC',
  base: 'BTC',
  quote: 'USDC',
  type: 'swap',
  active: true,
  contract: true,
  precision: { price: 1, amount: 0.001 },
  limits: {},
}

function fakeDataTransfer() {
  const store = new Map<string, string>()
  let dragImageSet = false
  return {
    effectAllowed: 'none',
    setData(type: string, value: string) {
      store.set(type, value)
    },
    getData(type: string) {
      return store.get(type) ?? ''
    },
    get types() {
      return [...store.keys()]
    },
    setDragImage() {
      dragImageSet = true
    },
    get dragImageSet() {
      return dragImageSet
    },
  } as unknown as DataTransfer & { types: string[]; dragImageSet: boolean }
}

describe('Trading market → agent link contract', () => {
  test('makes the market row a canonical resource drag and preserves its favourite action', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { PublicMarketRow } = await import('./PublicMarketsSidebar')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let opens = 0
    let favouriteToggles = 0

    try {
      await act(async () => {
        root.render(
          <PublicMarketRow
            connectionId="public:hyperliquid"
            market={MARKET}
            favourite={false}
            onOpen={() => {
              opens += 1
            }}
            onToggleFavourite={() => {
              favouriteToggles += 1
            }}
            embedded
          />,
        )
      })

      const row = host.querySelector<HTMLElement>('[data-market-resource-uri]')!
      const marketButton = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => !button.hasAttribute('data-market-row-action'),
      )!
      const favouriteButton = row.querySelector<HTMLButtonElement>('[data-market-row-action]')!
      expect(row.getAttribute('draggable')).toBe('true')
      expect(row.dataset.marketResourceUri).toBe(
        'localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC',
      )

      const transfer = fakeDataTransfer()
      await act(async () => {
        marketButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        const event = new Event('dragstart', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: transfer })
        marketButton.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      })

      expect(transfer.types).toContain(MESSAGE_BINDING_MIME)
      expect(acceptedDragKind(transfer.types, { messageBinding: true, attach: false })).toBe(
        'resource',
      )
      expect(composerDropHint('resource')).toBe('Link resource to message')
      expect(transfer.effectAllowed).toBe('copy')
      expect(transfer.getData('text/plain')).toBe(
        '@resource:localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC',
      )
      expect(transfer.dragImageSet).toBe(true)
      expect(readMessageBindingDrag(transfer)?.target).toMatchObject({
        kind: 'resource',
        label: 'BTC/USDC:USDC',
        uri: 'localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC',
      })
      expect(document.documentElement.dataset.localixAgentLinkDrag).toBe('resource')

      await act(async () => {
        const event = new Event('dragend', { bubbles: true })
        Object.defineProperty(event, 'dataTransfer', { value: transfer })
        marketButton.dispatchEvent(event)
      })
      expect(document.documentElement.dataset.localixAgentLinkDrag).toBeUndefined()

      const blockedTransfer = fakeDataTransfer()
      await act(async () => {
        favouriteButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        const event = new Event('dragstart', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: blockedTransfer })
        favouriteButton.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        favouriteButton.click()
      })
      expect(favouriteToggles).toBe(1)
      expect(opens).toBe(0)
      expect(blockedTransfer.types).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
