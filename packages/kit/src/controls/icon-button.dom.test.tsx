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

describe('IconButton action tooltips', () => {
  test('opens its explanation from the keyboard while the action stays disabled', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { X } = await import('lucide-react')
    const { IconButton } = await import('./icon-button')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <IconButton size="sm" aria-label="Voice input" tooltip="Voice input unavailable" disabled>
            <X />
          </IconButton>,
        ),
      )
      const anchor = host.querySelector<HTMLElement>('[data-disabled-tooltip-anchor]')!
      const button = host.querySelector<HTMLButtonElement>('button')!
      expect(anchor.tabIndex).toBe(0)
      expect(button.disabled).toBe(true)

      await act(async () => anchor.focus())
      const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')
      expect(document.activeElement).toBe(anchor)
      expect(tooltip).not.toBeNull()
      expect(tooltip?.textContent).toContain('Voice input unavailable')
      expect(anchor.getAttribute('aria-describedby')).toBe(tooltip!.id)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('composes one styled hint with a Radix menu trigger', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MoreHorizontal } = await import('lucide-react')
    const { ActionTooltip } = await import('../overlays/action-tooltip')
    const { IconButton } = await import('./icon-button')
    const { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } =
      await import('../overlays/dropdown-menu')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <DropdownMenu>
            <ActionTooltip label="Conversation actions" side="left">
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label="Conversation actions">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
            </ActionTooltip>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
        ),
      )
      const button = host.querySelector<HTMLButtonElement>('button')!
      expect(button.getAttribute('title')).toBeNull()
      expect(button.getAttribute('data-slot')).toBe('button')
      expect(button.getAttribute('data-tooltip-trigger')).toBe('true')

      await act(async () => button.focus())
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        'Conversation actions',
      )

      await act(async () => {
        button.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'mouse',
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(document.body.querySelector('[role="menu"]')?.textContent).toContain('Rename')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
