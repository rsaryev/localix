import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('tree navigation walks visible siblings, folds branches and keeps handled keys on the tree', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { FileTree } = await import('./FileTree')
  const board = document.createElement('div')
  const host = document.createElement('div')
  board.append(host)
  document.body.append(board)
  const root = createRoot(host)
  const boardKeys: string[] = []
  let edits = 0
  board.addEventListener('keydown', (event) => boardKeys.push(event.key))
  board.addEventListener('dblclick', () => edits++)
  const source = 'project/\n├── README.md\n└── src/\n    └── app.ts # entry point'
  const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const press = async (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => document.activeElement?.dispatchEvent(event))
    return event
  }
  try {
    await act(async () => root.render(<FileTree source={source} />))
    expect(host.querySelector('[role="tree"]')?.classList.contains('nodrag')).toBe(true)
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1)
    await act(async () => rows()[0]!.focus())
    await press('ArrowDown')
    expect(document.activeElement).toBe(rows()[1])
    await press('Enter')
    await press(' ')
    expect(rows()).toHaveLength(4)
    await press('End')
    expect(document.activeElement).toBe(rows()[3])
    await press('ArrowLeft')
    expect(document.activeElement).toBe(rows()[2])
    await press('ArrowLeft')
    expect(rows()).toHaveLength(3)
    expect(rows()[2]!.getAttribute('aria-expanded')).toBe('false')
    await press('ArrowRight')
    expect(rows()).toHaveLength(4)
    await press('ArrowRight')
    expect(document.activeElement).toBe(rows()[3])
    await press('Home')
    await press(' ')
    expect(rows()).toHaveLength(1)
    await press('Enter')
    expect(rows()).toHaveLength(4)
    expect(boardKeys).toEqual([])
    await act(async () => {
      rows()[2]!.click()
      rows()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(document.activeElement).toBe(rows()[2])
    expect(edits).toBe(0)
    await press('Escape')
    expect(boardKeys).toEqual(['Escape'])
  } finally {
    await act(async () => root.unmount())
    board.remove()
  }
})
