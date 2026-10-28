import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import { card } from '../testing/fakeBoardBackend'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/**
 * The board re-renders on EVERY drag-over frame (drop-indicator churn) and on every
 * board stream frame. Before `memo(TaskCard)`, that re-rendered every card in every
 * column each time — hundreds of card renders per drag on a busy board.
 *
 * Counting renders directly needs a hook inside the card, which would be test-only
 * machinery in production code. Instead we exploit a real read the card performs:
 * a card with dependencies asks `doneIds.has(...)` while rendering. A Set that
 * counts `has` calls therefore counts card renders, with no production change.
 */
function countingDoneIds() {
  const inner = new Set<string>()
  let reads = 0
  const set = new Set<string>() as Set<string> & { reads: () => number }
  set.has = (id: string) => {
    reads += 1
    return inner.has(id)
  }
  set.reads = () => reads
  return set
}

// A dependency is what makes the card read `doneIds` — the render probe.
const task = (id: string) =>
  card({ id, status: 'ready', title: `Task ${id}`, dependsOn: ['LX-99'] }) as never

const NOOP_ACTIONS = {
  open: () => {},
  quickMove: () => {},
  keyboardMove: () => {},
  select: () => {},
  dragStart: () => {},
  dragEnd: () => {},
  requestDelete: () => {},
}

describe('a board frame does not re-render every card', () => {
  test('cards whose props are unchanged do not render again', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TaskCard } = await import('./cards')

    const doneIds = countingDoneIds()
    const tasks = [task('t1'), task('t2'), task('t3')]

    let bump: (n: number) => void = () => {}
    function Board() {
      // Stands in for the board's own churning state (dropTarget / draggingId):
      // it changes, the board re-renders, but no card's props change.
      const [frame, setFrame] = React.useState(0)
      React.useEffect(() => {
        bump = setFrame
      }, [setFrame])
      return React.createElement(
        'div',
        { 'data-frame': frame },
        tasks.map((t) =>
          React.createElement(TaskCard, {
            key: (t as { id: string }).id,
            task: t,
            doneIds,
            dragging: false,
            selected: false,
            actions: NOOP_ACTIONS,
          }),
        ),
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(Board))
    })
    const afterMount = doneIds.reads()
    expect(afterMount).toBeGreaterThan(0)

    // Three more board frames, as a drag-over would produce.
    for (const n of [1, 2, 3]) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- frames must commit in order
      await act(async () => {
        bump(n)
      })
    }

    expect(doneIds.reads()).toBe(afterMount)

    await act(async () => root.unmount())
    host.remove()
  })

  test('the one card that DID change still re-renders', async () => {
    // The bail-out must be about unchanged props, not about freezing the board.
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TaskCard } = await import('./cards')

    const doneIds = countingDoneIds()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    // Same task object both times — only `dragging` differs, so a re-render here
    // proves the comparison is per-prop and not "identical element, never update".
    const only = task('t1')
    const render = (dragging: boolean) =>
      React.createElement(TaskCard, {
        task: only,
        doneIds,
        dragging,
        selected: false,
        actions: NOOP_ACTIONS,
      } as never)

    await act(async () => {
      root.render(render(false))
    })
    const afterMount = doneIds.reads()
    await act(async () => {
      root.render(render(true))
    })

    expect(doneIds.reads()).toBeGreaterThan(afterMount)

    await act(async () => root.unmount())
    host.remove()
  })
})
