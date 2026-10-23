import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('Tooltip portal contract', () => {
  test('associates a portalled rich surface with its trigger', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Tooltip, TooltipContent, TooltipTrigger } = await import('./tooltip')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Tooltip open>
            <TooltipTrigger asChild>
              <button type="button">Usage</button>
            </TooltipTrigger>
            <TooltipContent className="w-64 items-stretch">
              <strong>Context usage</strong>
              <span>Latest attempt</span>
            </TooltipContent>
          </Tooltip>,
        ),
      )

      const trigger = host.querySelector<HTMLButtonElement>('button')!
      const content = document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!
      // Radix puts the role and id on the surface itself; it no longer copies the text into a
      // visually hidden child.
      const accessibleDescription = content

      expect(content).not.toBeNull()
      expect(content.getAttribute('data-state')).not.toBe('closed')
      expect(host.contains(content)).toBe(false)
      expect(content.getAttribute('role')).toBe('tooltip')
      expect(trigger.getAttribute('aria-describedby')).toBe(accessibleDescription.id)
      expect(accessibleDescription.textContent).toContain('Context usage')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
