import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import type { KanbanTask } from '../../shared/contracts'
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
 * The panel re-renders for state unrelated to the card (a copy tick, a confirm dialog, a frame
 * about another card's slice). The header and body are memoized so those updates do not rebuild
 * the Markdown, chips and checklist. Counting renders from outside would only prove that a
 * test-local `memo` works, so — as in `cards.memo.test` — the probe is a real read each component
 * performs while rendering: the body reads `detail.description`, and the header asks
 * `doneIds.has(...)` for each dependency chip.
 */
function countingDetail(over: Partial<KanbanTask> = {}) {
  let reads = 0
  const base = card({
    id: 'LX-1',
    status: 'ready',
    title: 'Do the thing',
    dependsOn: ['LX-2'],
    subtasks: [{ id: 's1', text: 'step one', done: false }],
    ...over,
  })
  const detail = Object.defineProperty(base, 'description', {
    get() {
      reads += 1
      return 'A description the body would re-render as markdown on every frame.'
    },
    enumerable: true,
    configurable: true,
  })
  return { detail, reads: () => reads }
}

function countingDoneIds() {
  const set = new Set<string>() as Set<string> & { reads: () => number }
  let reads = 0
  set.has = () => {
    reads += 1
    return false
  }
  set.reads = () => reads
  return set
}

const EMPTY_TASKS: KanbanTask[] = []
const EMPTY_LABELS: string[] = []
const noop = () => {}

describe('the task panel keeps stable subtrees memoized', () => {
  test('an unrelated panel update re-renders neither the header nor the body', async () => {
    const React = await import('react')
    const { act, useEffect, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { TaskDetailHeader } = await import('./TaskDetailHeader')
    const { TaskDetailBody } = await import('./task-detail-body')

    const probe = countingDetail()
    const doneIds = countingDoneIds()

    let pushFrame: (n: number) => void = () => {}
    function Panel() {
      const [frames, setFrames] = useState(0)
      useEffect(() => {
        pushFrame = setFrames
      }, [setFrames])
      return (
        <>
          <TaskDetailHeader
            detail={probe.detail}
            parent={undefined}
            doneIds={doneIds}
            deps={EMPTY_TASKS}
            refCopied={false}
            onCopyRef={noop}
            onOpenTask={noop}
            onOpenFile={noop}
            onSetStatus={noop}
            onDelete={noop}
            onRemoveAttached={noop}
            onAddLabel={noop}
            onRemoveLabel={noop}
            labelSuggestions={EMPTY_LABELS}
          />
          <TaskDetailBody
            detail={probe.detail}
            epicChildren={EMPTY_TASKS}
            onOpenTask={noop}
            onWriteSubtasks={noop}
          />
          <span>{frames}</span>
        </>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Panel />))
      const afterMount = { body: probe.reads(), header: doneIds.reads() }
      // Without these, the assertions below would hold for a component that never rendered.
      expect(afterMount.body).toBeGreaterThan(0)
      expect(afterMount.header).toBeGreaterThan(0)

      for (let i = 1; i <= 5; i += 1) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- frames must commit in order
        await act(async () => pushFrame(i))
      }

      expect(probe.reads()).toBe(afterMount.body)
      expect(doneIds.reads()).toBe(afterMount.header)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('a change to the card itself still reaches the body', async () => {
    // The boundary must preserve real card updates, not freeze the panel.
    const React = await import('react')
    const { act, useEffect, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { TaskDetailBody } = await import('./task-detail-body')

    const first = countingDetail()
    const second = countingDetail({ title: 'Renamed' })

    let replace: (d: KanbanTask) => void = () => {}
    function Panel() {
      const [current, setCurrent] = useState(first.detail)
      useEffect(() => {
        replace = setCurrent
      }, [setCurrent])
      return (
        <TaskDetailBody
          detail={current}
          epicChildren={EMPTY_TASKS}
          onOpenTask={noop}
          onWriteSubtasks={noop}
        />
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Panel />))
      expect(second.reads()).toBe(0)

      await act(async () => replace(second.detail))
      expect(second.reads()).toBeGreaterThan(0)
    } finally {
      await act(async () => root.unmount())
    }
  })
})
