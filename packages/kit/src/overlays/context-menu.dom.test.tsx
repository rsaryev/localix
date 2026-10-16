import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './context-menu'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('shared context menu', () => {
  test('portals a pane-constrained menu outside clipping panes', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <div className="overflow-hidden">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button type="button">Conversation</button>
              </ContextMenuTrigger>
              <ContextMenuContent collisionBoundary={host}>
                <ContextMenuItem>Rename</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>,
        )
      })

      await act(async () => {
        host.querySelector('button')!.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: 180,
            clientY: 30,
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')
      expect(menu?.textContent).toContain('Rename')
      expect(host.contains(menu)).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
