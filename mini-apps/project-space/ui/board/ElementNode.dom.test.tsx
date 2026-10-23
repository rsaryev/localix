import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import type { SpaceOp } from '../../shared/ops/contract'
import { BoardContext, createFlagStore, type BoardActions } from './context'
import { ELEMENT_NODE, toFlow } from './toFlow'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

async function mountElement(type: string, props: Record<string, unknown>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Canvas, CanvasProvider } = await import('@localixai/kit/canvas')
  const { ElementNode } = await import('./ElementNode')
  const { space } = applyOps(emptySpace(), [{ op: 'create', id: 'a', type, props }], {
    registry: spaceTypes,
  })
  const { nodes } = toFlow(
    {
      space,
      issues: [],
      writable: true,
      revision: 'r',
      canUndo: false,
      canRedo: false,
      missing: [],
      stamps: {},
    },
    spaceTypes,
  )
  const flags = createFlagStore()
  const focuses: string[] = []
  const edits: (string | null)[] = []
  const writes: (readonly SpaceOp[])[] = []
  const keys: string[] = []
  const events: string[] = []
  let clicks = 0
  let drags = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const actions: BoardActions = {
    sessionId: 'board-chat',
    flags,
    apply: (ops) => {
      writes.push(ops)
      events.push('write')
    },
    focus: (id) => {
      focuses.push(id)
      events.push('focus')
    },
    grow: () => {},
    setEditing: (id) => {
      edits.push(id)
      flags.set({ editing: id, single: null })
    },
  }
  await act(async () =>
    root.render(
      <CanvasProvider initialWidth={800} initialHeight={600}>
        {/* This fixture mounts once; actions is already stable outside React's render cycle. */}
        {/* oxlint-disable-next-line react/jsx-no-constructed-context-values */}
        <BoardContext.Provider value={actions}>
          <Canvas
            label="Element interaction"
            interaction="edit"
            nodes={nodes}
            edges={[]}
            nodeTypes={{ [ELEMENT_NODE]: ElementNode }}
            controls={false}
            onNodeClick={() => clicks++}
            onNodeDragStart={() => drags++}
            onBoardKey={(event) => {
              keys.push(event.key)
              return true
            }}
          />
        </BoardContext.Provider>
      </CanvasProvider>,
    ),
  )
  return {
    host,
    flags,
    focuses,
    edits,
    writes,
    keys,
    events,
    clicks: () => clicks,
    drags: () => drags,
    drag: (target: Element) =>
      act(async () => {
        const mouse = (at: EventTarget, type: string, x: number, buttons = 1) =>
          at.dispatchEvent(
            new MouseEvent(type, {
              clientX: x,
              clientY: 100,
              button: 0,
              buttons,
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          )
        mouse(target, 'mousedown', 100)
        mouse(window, 'mousemove', 120)
        mouse(window, 'mouseup', 120, 0)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }),
    click: (target: Element) =>
      act(async () => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }),
    doubleClick: (target: Element) =>
      act(async () => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))),
    press: (target: Element, key: string) =>
      act(async () =>
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        ),
      ),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('a link focuses its card even when its action stops bubbling; its double-click stays inside', async () => {
  const board = await mountElement('note', { text: 'Read https://example.com' })
  try {
    const link = board.host.querySelector('button[aria-label^="Link options"]')!
    await board.click(link)
    expect(board.focuses).toEqual(['a'])
    expect(board.clicks()).toBe(0)
    await board.doubleClick(link)
    expect(board.edits).toEqual([])
    const open = document.querySelector('button:not(.react-flow__controls-button)')
    expect(document.querySelector('[data-slot="popover-content"]')?.textContent).toContain(
      'Open website',
    )
    // The popover is a React descendant but not content physically inside the card.
    const popover = document.querySelector('[data-slot="popover-content"]')!
    await board.doubleClick(popover)
    expect(board.edits).toEqual([])
    expect(open).not.toBeNull()
  } finally {
    await board.unmount()
  }
})

test('checklist controls update their source without entering its editor', async () => {
  const board = await mountElement('text', { text: '- [ ] Verify the build', size: 'md' })
  try {
    const box = board.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await board.click(box)
    expect(board.focuses).toEqual(['a'])
    expect(board.writes).toEqual([
      [{ op: 'update', id: 'a', props: { text: '- [x] Verify the build' } }],
    ])
    expect(board.events).toEqual(['write', 'focus'])
    await board.doubleClick(box)
    await board.press(box, 'Enter')
    expect(board.edits).toEqual([])
    expect(board.keys).toEqual([])
  } finally {
    await board.unmount()
  }
})

test('tree keys never edit, move or delete the containing card', async () => {
  const board = await mountElement('text', {
    text: '```tree\nproject/\n└── app.ts\n```',
    size: 'md',
  })
  try {
    const tree = board.host.querySelector('[role="treeitem"]')!
    await board.click(tree)
    expect(board.focuses).toEqual(['a'])
    for (const key of ['Delete', 'Backspace', 'Enter', 'ArrowDown']) await board.press(tree, key)
    await board.doubleClick(tree)
    expect(board.keys).toEqual([])
    expect(board.edits).toEqual([])
    expect(board.writes).toEqual([])
  } finally {
    await board.unmount()
  }
})

test('the file button opens once per click without also invoking the card open on double-click', async () => {
  const { miniAppWorkspace } = await import('@localixai/mini-app-sdk/ui/runtime')
  const { spaceApi } = await import('../api')
  const open = spyOn(miniAppWorkspace, 'openFile').mockImplementation(() => {})
  const read = spyOn(spaceApi, 'text').mockResolvedValue({
    text: '',
    binary: false,
    truncated: false,
  })
  const board = await mountElement('file', { path: 'src/app.ts' })
  try {
    const button = board.host.querySelector('[aria-label="Open in the editor"]')!
    // Host controls need no knowledge of the board's drag contract.
    button.classList.remove('nodrag')
    await board.drag(button)
    expect(board.drags()).toBe(0)
    await board.click(button)
    await board.doubleClick(button)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith({ sessionId: 'board-chat', path: 'src/app.ts' })
    expect(board.focuses).toEqual(['a'])
    expect(board.edits).toEqual([])
    await board.doubleClick(board.host.querySelector('.react-flow__node .text-xs')!)
    expect(open).toHaveBeenCalledTimes(2)
  } finally {
    await board.unmount()
    open.mockRestore()
    read.mockRestore()
  }
})

test('plain content still edits deliberately; double-clicking its textarea does not re-enter editing', async () => {
  const board = await mountElement('note', { text: 'An ordinary note' })
  try {
    const content = board.host.querySelector('p')!
    await board.drag(content)
    expect(board.drags()).toBe(1)
    await board.click(content)
    expect(board.clicks()).toBe(1)
    await board.doubleClick(content)
    expect(board.edits).toEqual(['a'])
    const editor = board.host.querySelector('textarea')!
    expect(editor).not.toBeNull()
    await board.doubleClick(editor)
    await board.press(editor, 'ArrowLeft')
    expect(board.edits).toEqual(['a'])
    expect(board.keys).toEqual([])
    expect(board.focuses).toEqual([])
  } finally {
    await board.unmount()
  }
})

test('closing a card cancels the focus scheduled by its control', async () => {
  const { act } = await import('react')
  const board = await mountElement('note', { text: 'Read https://example.com' })
  try {
    void act(() =>
      board.host
        .querySelector('button[aria-label^="Link options"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
  } finally {
    await board.unmount()
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(board.focuses).toEqual([])
})
