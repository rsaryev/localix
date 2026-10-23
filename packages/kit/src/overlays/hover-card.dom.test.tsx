import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('HoverCard', () => {
  test('portals rich content as one vertical pointer-accessible surface', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HoverCard, HoverCardContent, HoverCardTrigger } = await import('./hover-card')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <HoverCard open>
            <HoverCardTrigger asChild>
              <button type="button">Usage</button>
            </HoverCardTrigger>
            <HoverCardContent className="w-64 gap-3 select-text">
              <section>Context usage</section>
              <section>Context limits</section>
            </HoverCardContent>
          </HoverCard>,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('button')!
      const content = document.body.querySelector<HTMLElement>('[data-slot="hover-card-content"]')!
      expect(trigger.getAttribute('data-slot')).toBe('hover-card-trigger')
      expect(content).not.toBeNull()
      expect(host.contains(content)).toBe(false)
      expect(content.children).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
