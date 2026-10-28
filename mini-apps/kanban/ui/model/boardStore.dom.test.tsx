import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import { BOARD_SUBSCRIBE, BOARD_UNSUBSCRIBE } from '../../shared/resource'
import { card, fakeBoardBackend, type FakeBoardBackend } from '../testing/fakeBoardBackend'
import { applyBoardEvent, reconcileBoard, resetBoardStore } from './boardStore'

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

let backend: FakeBoardBackend
afterEach(() => {
  resetBoardStore()
  backend?.unbind()
})

/**
 * The mirror exists because every surface that wanted a board used to own a private copy: its own
 * read, its own stream and its own full-list state, so three open task tabs meant four reads and
 * four components re-rendering on every delta. These tests pin the three things the shared mirror
 * has to get right instead — one read and one subscription per chat, slices that re-render only
 * for their own card, and a board that stays TRUE across a race, a gap and a reconnect.
 */
async function harness(initial = { s1: [card({ id: 'LX-1', kind: 'epic' })] }) {
  backend = fakeBoardBackend({
    ...initial,
    s2: [card({ id: 'LX-1', title: 'Another chat’s card' })],
  })
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const settle = () =>
    React.act(async () => {
      await turns()
    })
  const render = async (node: React.ReactNode) => {
    await React.act(async () => root.render(node))
    await settle()
  }
  return { React, root, render, settle, unmount: () => React.act(async () => root.unmount()) }
}

const subscribes = (sessionId: string) =>
  backend.realtime.filter((r) => r.t === BOARD_SUBSCRIBE && r.sessionId === sessionId).length

describe('one mirror per chat', () => {
  test('four surfaces of one chat share one read and one subscription', async () => {
    const h = await harness()
    const { useBoardTasks, useBoardTask, useBoardChildren } = await import('./useBoard')
    function Board() {
      useBoardTasks('s1')
      return null
    }
    function TaskTab({ id }: { id: string }) {
      useBoardTask('s1', id)
      useBoardChildren('s1', id)
      return null
    }
    await h.render(
      <>
        <Board />
        <Board />
        <TaskTab id="LX-1" />
        <TaskTab id="LX-2" />
      </>,
    )
    expect(backend.reads('s1')).toBe(1)
    expect(subscribes('s1')).toBe(1)
    await h.unmount()
    expect(backend.realtime.at(-1)).toEqual({ t: BOARD_UNSUBSCRIBE, sessionId: 's1' })
  })

  test('two chats never see each other’s cards, and every request names its chat', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    const seen: Record<string, string[]> = {}
    function Board({ sessionId }: { sessionId: string }) {
      const titles = useBoardTasks(sessionId).tasks.map((t) => t.title)
      h.React.useEffect(() => {
        seen[sessionId] = titles
      })
      return null
    }
    await h.render(
      <>
        <Board sessionId="s1" />
        <Board sessionId="s2" />
      </>,
    )
    await h.React.act(async () =>
      backend.push({ type: 'task.created', sessionId: 's2', task: card({ id: 'LX-2' }) }),
    )
    expect(seen.s1).toEqual(['LX-1'])
    expect(seen.s2).toEqual(['Another chat’s card', 'LX-2'])
    expect(backend.requests.every((r) => r.sessionId === 's1' || r.sessionId === 's2')).toBe(true)
    await h.unmount()
  })

  test('a slice re-renders only when ITS card changes', async () => {
    const h = await harness({ s1: [card({ id: 'LX-1' }), card({ id: 'LX-2' })] })
    const { useBoardTask } = await import('./useBoard')
    let renders = 0
    function TaskTab() {
      useBoardTask('s1', 'LX-2')
      // Counted when the render commits, so nothing is written while rendering.
      h.React.useEffect(() => {
        renders += 1
      })
      return null
    }
    await h.render(<TaskTab />)
    const afterRead = renders

    const other = card({ id: 'LX-1', title: 'Renamed', updatedAt: '2026-09-27T00:00:00.000Z' })
    await h.React.act(async () =>
      backend.push({ type: 'task.updated', sessionId: 's1', task: other }),
    )
    expect(renders).toBe(afterRead)

    const own = card({ id: 'LX-2', title: 'Renamed', updatedAt: '2026-09-27T00:00:00.000Z' })
    await h.React.act(async () =>
      backend.push({ type: 'task.updated', sessionId: 's1', task: own }),
    )
    expect(renders).toBeGreaterThan(afterRead)
    await h.unmount()
  })
})

describe('the mirror stays true', () => {
  test('a change that lands while a read is in flight survives the read’s older answer', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    let ids: string[] = []
    function Board() {
      const current = useBoardTasks('s1').tasks.map((t) => t.id)
      h.React.useEffect(() => {
        ids = current
      })
      return null
    }
    await h.render(<Board />)
    await h.React.act(async () => {
      const read = reconcileBoard('s1')
      backend.push({ type: 'task.created', sessionId: 's1', task: card({ id: 'LX-9' }) })
      await read
    })
    expect(ids).toEqual(['LX-1', 'LX-9'])
    await h.unmount()
  })

  test('an older copy of a card never replaces a newer one', () => {
    const newer = card({ id: 'LX-1', title: 'New', updatedAt: '2026-09-26T12:00:00.000Z' })
    const older = card({ id: 'LX-1', title: 'Old', updatedAt: '2026-09-26T11:00:00.000Z' })
    const tasks = [newer]
    expect(applyBoardEvent(tasks, { type: 'task.updated', sessionId: 's1', task: older })).toBe(
      tasks,
    )
  })

  test('a reopened board paints from cache, then reads again — the stream missed the gap', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    const seen: Array<{ count: number; loading: boolean }> = []
    function Board() {
      const { tasks, loading } = useBoardTasks('s1')
      seen.push({ count: tasks.length, loading })
      return null
    }
    await h.render(<Board />)
    await h.render(<></>)
    seen.length = 0
    await h.render(<Board />)
    expect(seen[0]).toEqual({ count: 1, loading: false })
    expect(backend.reads('s1')).toBe(2)
    await h.unmount()
  })

  test('a reconnect re-subscribes and reads the board again', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    function Board() {
      useBoardTasks('s1')
      return null
    }
    await h.render(<Board />)
    await h.React.act(async () => backend.reconnect())
    await h.settle()
    expect(subscribes('s1')).toBe(2)
    expect(backend.reads('s1')).toBe(2)
    await h.unmount()
  })

  test('a failed first read settles with its reason instead of loading forever', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    let state: { loading: boolean; error: string | null } = { loading: true, error: null }
    function Board() {
      const { loading, error } = useBoardTasks('s1')
      h.React.useEffect(() => {
        state = { loading, error }
      })
      return null
    }
    backend.refuseNext(503, 'board_unavailable', 'The board could not be saved. Try again.')
    await h.render(<Board />)
    expect(state).toEqual({ loading: false, error: 'The board could not be saved. Try again.' })
    await h.unmount()
  })

  test('development StrictMode starts one read', async () => {
    const h = await harness()
    const { useBoardTasks } = await import('./useBoard')
    function Board() {
      useBoardTasks('s1')
      return null
    }
    await h.render(
      <h.React.StrictMode>
        <Board />
      </h.React.StrictMode>,
    )
    expect(backend.reads('s1')).toBe(1)
    await h.unmount()
  })
})
