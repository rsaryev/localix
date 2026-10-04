import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

async function mountBoard(props: {
  onBoardKey?: (event: { key: string }) => boolean
  overlay?: 'input'
}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Canvas } = await import('./Canvas')
  const { CanvasProvider } = await import('./primitives')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <CanvasProvider>
        <Canvas
          label="Test board"
          nodes={[]}
          edges={[]}
          onBoardKey={props.onBoardKey}
          overlay={props.overlay === 'input' ? <input aria-label="Filter" /> : undefined}
        />
      </CanvasProvider>,
    )
  })
  const board = host.querySelector<HTMLElement>('[role="application"]')
  if (!board) throw new Error('no board rendered')
  const press = async (target: HTMLElement, key: string) => {
    await React.act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }
  return { host, board, press, unmount: () => React.act(async () => root.unmount()) }
}

describe('Canvas', () => {
  test('tells assistive technology what the board is and how its keys move the camera', async () => {
    const { board, unmount } = await mountBoard({})
    expect(board.getAttribute('aria-label')).toStartWith('Test board. Arrow keys pan')
    expect(board.getAttribute('aria-label')).toContain('Shift+1 fits everything')
    expect(board.dataset.interaction).toBe('navigate')
    await unmount()
  })

  test("the owner's key comes first, and a key typed into a control on the board is never asked", async () => {
    const asked: string[] = []
    const { host, board, press, unmount } = await mountBoard({
      overlay: 'input',
      onBoardKey: (event) => {
        asked.push(event.key)
        return event.key === 'Backspace'
      },
    })
    await press(board, 'Backspace')
    await press(host.querySelector<HTMLElement>('input[aria-label="Filter"]')!, 'Backspace')
    expect(asked).toEqual(['Backspace'])
    await unmount()
  })

  test('the gesture hint is taught once for every board', async () => {
    const { resetDismissed, HINT } = await import('../lib/dismissable')
    resetDismissed(HINT.canvasGestures)
    const first = await mountBoard({})
    const dismiss = first.host.querySelector<HTMLElement>('[aria-label="Dismiss the hint"]')
    expect(dismiss).not.toBeNull()
    const React = await import('react')
    await React.act(async () => dismiss?.click())
    expect(first.host.querySelector('[aria-label="Dismiss the hint"]')).toBeNull()
    await first.unmount()

    const second = await mountBoard({})
    expect(second.host.querySelector('[aria-label="Dismiss the hint"]')).toBeNull()
    await second.unmount()
    resetDismissed(HINT.canvasGestures)
  })

  test('native links and nested widgets keep their keyboard input', async () => {
    const asked: string[] = []
    const { host, board, press, unmount } = await mountBoard({
      onBoardKey: (event) => {
        asked.push(event.key)
        return true
      },
    })
    try {
      const tree = document.createElement('div')
      tree.setAttribute('role', 'tree')
      const item = document.createElement('div')
      item.setAttribute('role', 'treeitem')
      tree.append(item)
      const link = document.createElement('a')
      link.href = '#file'
      const editable = document.createElement('div')
      editable.setAttribute('contenteditable', '')
      board.append(tree, link, editable)
      await press(item, 'Delete')
      await press(item, 'Enter')
      await press(link, 'Enter')
      await press(editable, 'Backspace')
      expect(asked).toEqual([])
      await press(board, 'Delete')
      expect(asked).toEqual(['Delete'])
    } finally {
      await unmount()
      host.remove()
    }
  })
})
