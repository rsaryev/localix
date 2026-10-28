import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import type { KanbanMove, KanbanTask } from '../../shared/contracts'
import { card, fakeBoardBackend } from '../testing/fakeBoardBackend'
import { capColumn, KANBAN_COLUMN_CAP } from './columnCap'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/**
 * A capped column has to keep the gesture it exists for. `onSectionDragOver` counts the column's
 * rendered `[data-task-card]` nodes to pick an insertion index and the drop applies that index to
 * the LOGICAL section list — so the cap is only safe while the rendered cards are the logical
 * list's prefix. These tests drop onto a capped column and check where the card actually lands.
 */
const CARD_H = 40

/** A column body holding `count` rendered cards, laid out as a real stack. */
function renderedColumn(count: number) {
  const section = document.createElement('div')
  for (let i = 0; i < count; i++) {
    const node = document.createElement('div')
    node.setAttribute('data-task-card', '')
    node.getBoundingClientRect = () =>
      ({ top: i * CARD_H, height: CARD_H, bottom: (i + 1) * CARD_H }) as DOMRect
    section.appendChild(node)
  }
  return section
}

const dragOverEvent = (section: HTMLElement, clientY: number) =>
  ({
    preventDefault: () => {},
    stopPropagation: () => {},
    currentTarget: section,
    clientY,
    dataTransfer: { dropEffect: '' },
  }) as never

const dropEvent = () =>
  ({
    preventDefault: () => {},
    stopPropagation: () => {},
    dataTransfer: { dropEffect: '' },
  }) as never

const dragStartEvent = () =>
  ({
    dataTransfer: { effectAllowed: '', setData: () => {}, types: [], setDragImage: () => {} },
  }) as never

/** One busy lane: 400 backlog cards at sortOrder 10, 20, 30 … plus a card to drag in. */
function board(): KanbanTask[] {
  const backlog = Array.from({ length: 400 }, (_, i) =>
    card({ id: `LX-${i + 10}`, status: 'backlog', sortOrder: (i + 1) * 10 }),
  )
  return [...backlog, card({ id: 'LX-1', status: 'ready', sortOrder: 1, title: 'Me' })]
}

async function harness() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useKanbanDrag } = await import('./useKanbanDrag')

  const sent: KanbanMove[][] = []
  const tasks = board()
  let api: ReturnType<typeof useKanbanDrag> | undefined
  function Probe() {
    const drag = useKanbanDrag('s1', tasks, tasks, async (moves) => void sent.push(moves))
    React.useEffect(() => {
      api = drag
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Probe />))
  return {
    tasks,
    api: () => api!,
    sent,
    act: React.act,
    unmount: () => React.act(async () => root.unmount()),
  }
}

async function dropAt(clientY: number) {
  const h = await harness()
  const rendered = capColumn(
    { epicCards: [], groups: [], loose: h.tasks.filter((t) => t.status === 'backlog') },
    KANBAN_COLUMN_CAP,
  )
  const section = renderedColumn(rendered.loose.length)
  await h.act(async () => h.api().onCardDragStart(dragStartEvent(), h.tasks.at(-1)!))
  await h.act(async () =>
    h.api().onSectionDragOver(dragOverEvent(section, clientY), 'backlog', null),
  )
  const index = h.api().dropTarget?.index
  await h.act(async () => h.api().onSectionDrop(dropEvent(), 'backlog', null))
  return { ...h, rendered, index }
}

describe('a capped column still drops cards where the indicator promised', () => {
  test('only the cap is rendered, and a drop between visible cards lands there', async () => {
    // The column holds 400 cards; 60 are mounted. Drop just above the 4th card's middle.
    const h = await dropAt(3 * CARD_H + 5)
    expect(h.rendered.loose.length).toBe(KANBAN_COLUMN_CAP)
    expect(h.index).toBe(3)
    // MUTATION: render the LAST 60 cards instead of the first 60 → this sortOrder lands the card
    // near the end of the lane instead of between the 3rd and 4th card → red.
    const [move] = h.sent[0]!
    expect(h.sent[0]!.map((m) => m.id)).toEqual(['LX-1'])
    expect(move!.status).toBe('backlog')
    expect(move!.sortOrder).toBeGreaterThan(30)
    expect(move!.sortOrder).toBeLessThan(40)
    await h.unmount()
  })

  test('a drop at the bottom of the capped list lands after the last VISIBLE card', async () => {
    const h = await dropAt(KANBAN_COLUMN_CAP * CARD_H + 200)
    expect(h.index).toBe(KANBAN_COLUMN_CAP)
    const sortOrder = h.sent[0]![0]!.sortOrder
    expect(sortOrder).toBeGreaterThan(KANBAN_COLUMN_CAP * 10)
    expect(sortOrder).toBeLessThan((KANBAN_COLUMN_CAP + 1) * 10)
    await h.unmount()
  })
})

describe('a quick move is one request the rules allow', () => {
  test('a card moves to the bottom of its new column; a closed card is never sent', async () => {
    const backend = fakeBoardBackend({
      s1: [
        card({ id: 'LX-1', status: 'backlog' }),
        card({ id: 'LX-2', status: 'ready', sortOrder: 7 }),
        card({ id: 'LX-3', status: 'cancelled' }),
      ],
    })
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useBoardTasks } = await import('../model/useBoard')
    const { resetBoardStore } = await import('../model/boardStore')
    const { useBoardWrites } = await import('./useBoardWrites')
    let writes: ReturnType<typeof useBoardWrites> | undefined
    function Probe() {
      const value = useBoardWrites('s1', useBoardTasks('s1'))
      React.useEffect(() => {
        writes = value
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    await React.act(async () => root.render(<Probe />))
    await React.act(async () => turns())

    await React.act(() => writes!.quickMove('LX-1', 'ready'))
    await React.act(() => writes!.quickMove('LX-3', 'ready'))

    const moves = backend.requests.filter((r) => r.path.endsWith('/moves'))
    expect(moves).toEqual([
      {
        method: 'POST',
        path: '/rpc/kanban/moves',
        sessionId: 's1',
        body: { moves: [{ id: 'LX-1', status: 'ready', sortOrder: 8 }] },
      },
    ])
    await React.act(async () => root.unmount())
    resetBoardStore()
    backend.unbind()
  })
})

describe('the cap shows its affordance', () => {
  async function mountMore(hidden: number) {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ColumnMore } = await import('./column-more')
    const presses: number[] = []
    const host = document.createElement('div')
    const root = createRoot(host)
    await React.act(async () =>
      root.render(
        <ColumnMore hidden={hidden} columnTitle="Backlog" onShowMore={() => presses.push(1)} />,
      ),
    )
    return { host, presses, act: React.act, unmount: () => React.act(async () => root.unmount()) }
  }

  test('it names how many cards are held back and reveals them when pressed', async () => {
    const h = await mountMore(340)
    const button = h.host.querySelector<HTMLButtonElement>('button')!
    expect(button.textContent).toBe('Show 340 more')
    expect(button.getAttribute('aria-label')).toBe('Show more cards in Backlog')
    await h.act(async () => button.click())
    expect(h.presses.length).toBe(1)
    await h.unmount()
  })

  test('it is not a drop slot — the drop-index scan must not count it', async () => {
    const h = await mountMore(340)
    expect(h.host.querySelectorAll('[data-task-card]').length).toBe(0)
    await h.unmount()
  })
})
