import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('ChatSidebarViewMenu', () => {
  test('one sidebar button opens grouping, order and archived visibility as one menu', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ChatSidebarViewMenu } = await import('./ChatSidebarViewMenu')
    const onGroupingModeChange = mock(() => {})
    const onSortModeChange = mock(() => {})
    const onShowArchivedChange = mock(() => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <ChatSidebarViewMenu
            groupingMode="activity"
            onGroupingModeChange={onGroupingModeChange}
            sortMode="recent"
            onSortModeChange={onSortModeChange}
            showArchived={false}
            onShowArchivedChange={onShowArchivedChange}
            archivedCount={2}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Conversation view options"]',
      )!
      expect(trigger).not.toBeNull()
      expect(trigger.getAttribute('data-surface')).toBe('sidebar')

      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        await settle()
      })

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      const rows = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
      const row = (text: string) => rows.find((item) => item.textContent?.includes(text))!

      // Each axis is a submenu row whose trailing hint is the current pick.
      expect(row('Group by').textContent).toContain('Activity')
      expect(row('Sort by').textContent).toContain('Recent')

      // Archived visibility is a real toggle; its count is a hint, not part of the label.
      const archived = row('Show archived')
      expect(archived.getAttribute('role')).toBe('menuitemcheckbox')
      expect(archived.getAttribute('aria-checked')).toBe('false')
      expect(archived.textContent).not.toContain('(2)')
      expect(archived.textContent).toContain('2')
      await act(async () => {
        archived.click()
        await settle()
      })
      expect(onShowArchivedChange).toHaveBeenCalledWith(true)
      // keepOpen: the menu that shows the toggle stays on screen.
      expect(trigger.getAttribute('aria-expanded')).toBe('true')

      await act(async () => {
        row('Group by').click()
        await settle()
      })
      const agent = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      ).find((item) => item.textContent?.includes('Agent'))!
      expect(agent.getAttribute('aria-checked')).toBe('false')
      await act(async () => {
        agent.click()
        await settle()
      })
      expect(onGroupingModeChange).toHaveBeenCalledWith('agent')
      expect(onSortModeChange).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
