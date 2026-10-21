import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  useMessageSearchStore.setState({ open: false, activeId: null, pending: null })
})

afterAll(() => teardown())

describe('focused conversation search ownership', () => {
  test('a newly focused warm chat consumes its pending query on mount', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MessageSearch } = await import('./MessageSearch')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    useMessageSearchStore.getState().requestSearch('s2', 'needle')

    try {
      await act(async () => {
        root.render(
          <MessageSearch
            sessionId="s2"
            messages={[{ id: 'm1', role: 'user', content: 'find the needle here' }]}
          />,
        )
      })

      expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('needle')
      const surface = host.querySelector<HTMLElement>('[data-slot="find-widget"][role="search"]')
      expect(surface?.getAttribute('aria-label')).toBe('Find in conversation')
      expect(surface?.querySelector('[data-slot="find-widget-input"]')).not.toBeNull()
      expect(surface?.querySelector('[data-slot="find-widget-count"]')?.textContent).toBe('1/1')
      expect(
        surface?.querySelector('[data-slot="find-widget-count"]')?.getAttribute('aria-label'),
      ).toBe('1 of 1 matches')
      expect(useMessageSearchStore.getState()).toMatchObject({
        open: true,
        activeId: 'm1',
        pending: null,
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
    expect(useMessageSearchStore.getState()).toMatchObject({ open: false, activeId: null })
  })
})
