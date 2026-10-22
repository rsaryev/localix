import { describe, expect, test } from 'bun:test'

import { createSubagentRowsLive, type Timers } from './subagent-rows-live'

/** Timers the test fires by hand: what is armed, and for how long, is the evidence. */
function manualTimers() {
  const armed = new Map<number, { run: () => void; ms: number }>()
  let next = 0
  const timers: Timers = {
    set: (run, ms) => {
      armed.set(++next, { run, ms })
      return next
    },
    clear: (handle) => void armed.delete(handle as number),
  }
  const delays = () => [...armed.values()].map((timer) => timer.ms)
  /** Fire what is armed now, then let the redraws it started settle. */
  const fire = async () => {
    const due = [...armed.values()]
    armed.clear()
    for (const timer of due) timer.run()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return { timers, delays, fire }
}

function setup(initial: { active?: boolean; running?: boolean } = {}) {
  const clock = manualTimers()
  const state = {
    rows: [{ id: 'child', content: 'mapper · 1k' }],
    active: true,
    running: true,
    ids: ['child'],
    watched: true,
    ...initial,
  }
  const pokes: string[] = []
  const tasks: Array<Record<string, number[]>> = []
  let draws = 0
  const live = createSubagentRowsLive({
    async compute(_userId, _sessionId, samples) {
      draws++
      tasks.push(Object.fromEntries(state.ids.map((id) => [id, samples(id, draws * 100)])))
      return {
        view: { active: state.active, rows: state.active ? state.rows : [] },
        running: state.running,
        ids: state.ids,
      }
    },
    watched: () => state.watched,
    publish: (userId) => void pokes.push(userId),
    locate: async (_userId, id) => (id === 'newborn' ? ['root', 'root'] : [null, null]),
    timers: clock.timers,
    tickMs: 2_000,
    debounceMs: 300,
  })
  return { live, clock, state, pokes, tasks, draws: () => draws }
}

describe('subagent rows the server keeps', () => {
  test('a burst of changes redraws once, and pokes only when the rows differ', async () => {
    const t = setup({ running: false })
    expect(await t.live.read('u1', 'root')).toEqual({
      active: true,
      rows: [{ id: 'child', content: 'mapper · 1k' }],
    })
    expect(t.clock.delays()).toEqual([])

    for (let i = 0; i < 3; i++) await t.live.changed('u1', 'child')
    // One redraw for the burst, as Claude Code batches its status line updates.
    expect(t.clock.delays()).toEqual([300])
    await t.clock.fire()
    expect(t.draws()).toBe(2)
    expect(t.pokes).toEqual([])

    t.state.rows = [{ id: 'child', content: 'mapper · 9k' }]
    await t.live.changed('u1', 'child')
    await t.clock.fire()
    expect(t.pokes).toEqual(['u1'])
    expect(await t.live.read('u1', 'root')).toEqual({ active: true, rows: t.state.rows })
    // The read served what was drawn: no draw of its own.
    expect(t.draws()).toBe(3)
  })

  test('ticks while a row runs and a client watches, and stops when either ends', async () => {
    const t = setup()
    await t.live.read('u1', 'root')
    expect(t.clock.delays()).toEqual([2_000])
    await t.clock.fire()
    expect(t.draws()).toBe(2)
    expect(t.clock.delays()).toEqual([2_000])
    // A change does not wait for the tick; the tick resumes after its redraw.
    await t.live.changed('u1', 'child')
    expect(t.clock.delays()).toEqual([300])
    await t.clock.fire()
    expect(t.clock.delays()).toEqual([2_000])

    t.state.running = false
    await t.clock.fire()
    expect(t.clock.delays()).toEqual([])

    // Nobody renders the conversation any more: the next redraw drops it.
    t.state.running = true
    t.state.watched = false
    await t.live.changed('u1', 'child')
    await t.clock.fire()
    expect(t.clock.delays()).toEqual([])
    await t.live.changed('u1', 'child')
    expect(t.clock.delays()).toEqual([])
    expect(t.draws()).toBe(5)
  })

  test('each tick hands the command the row’s recent token readings', async () => {
    const t = setup()
    await t.live.read('u1', 'root')
    for (let i = 0; i < 20; i++) await t.clock.fire()
    expect(t.tasks[0]).toEqual({ child: [100] })
    expect(t.tasks[2]).toEqual({ child: [100, 200, 300] })
    expect(t.tasks.at(-1)!.child).toHaveLength(16)
    expect(t.tasks.at(-1)!.child.at(-1)).toBe(2_100)
  })

  test('a child just born is placed by its parent', async () => {
    const t = setup({ running: false })
    await t.live.read('u1', 'root')
    await t.live.changed('u1', 'stranger', { locate: true })
    expect(t.clock.delays()).toEqual([])
    await t.live.changed('u1', 'newborn', { locate: true })
    expect(t.clock.delays()).toEqual([300])
    // Its messages alone do not place it: its birth notice does.
    await t.clock.fire()
    await t.live.changed('u1', 'another-unknown')
    expect(t.clock.delays()).toEqual([])
  })

  test('without a status line, row changes draw nothing; a plugin moving redraws', async () => {
    const t = setup({ active: false, running: false })
    expect(await t.live.read('u1', 'root')).toEqual({ active: false, rows: [] })
    await t.live.changed('u1', 'child')
    expect(t.clock.delays()).toEqual([])
    t.state.active = true
    t.live.refreshAll()
    await t.clock.fire()
    expect(t.pokes).toEqual(['u1'])
  })

  test('a deleted conversation is forgotten; a deleted row redraws its conversation', async () => {
    const t = setup({ running: false })
    await t.live.read('u1', 'root')
    t.live.deleted('u1', 'child')
    expect(t.clock.delays()).toEqual([300])
    t.live.deleted('u1', 'root')
    expect(t.clock.delays()).toEqual([])
    await t.live.read('u1', 'root')
    expect(t.draws()).toBe(2)
  })
})
