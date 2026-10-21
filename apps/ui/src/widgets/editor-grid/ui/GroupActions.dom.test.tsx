import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * Every group of tabs carries one button at the end of its strip: maximize the panel, restore it.
 * It drives the grid's own maximize, so the command, the shortcut and the button cannot disagree.
 */
describe('the panel button at the end of a tab strip', () => {
  test('is always there; maximizes the panel and restores it when there is something to fill', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { GroupActions } = await import('./GroupActions')
    const { useGridStore, groupOfTab } = await import('@/entities/workspace-grid/model')

    const grid = useGridStore.getState()
    grid.resetLayout()
    // A session kind opens only in the chat it names, under an id qualified by that chat.
    grid.openItem({ kind: 'probe:board', id: 'probe:board', title: 'Board', scope: 's1' })
    const group = groupOfTab(useGridStore.getState().root, 'probe:board@s1')!.id
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = () => act(async () => root.render(<GroupActions groupId={group} />))
    const button = () =>
      host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Maximize"], button[aria-label="Restore layout"]',
      )

    try {
      await render()
      // One group: in place, but disabled — there is nothing to maximize over.
      expect(button()!.disabled).toBe(true)

      await act(async () => {
        useGridStore.getState().splitGroup(group, 'right')
      })
      await render()
      expect(button()?.getAttribute('aria-label')).toBe('Maximize panel')

      await act(async () => button()!.click())
      expect(useGridStore.getState().maximizedGroup).toBe(group)
      expect(button()?.getAttribute('aria-label')).toBe('Restore layout')
      expect(button()?.getAttribute('aria-pressed')).toBe('true')

      await act(async () => button()!.click())
      expect(useGridStore.getState().maximizedGroup).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      useGridStore.getState().resetLayout()
    }
  })
})
