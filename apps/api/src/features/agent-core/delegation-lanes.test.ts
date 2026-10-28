import { afterEach, describe, expect, test } from 'bun:test'

import { DELEGATION_SLOT_CAP } from './delegation-budget'
import {
  __resetDelegationLanes,
  cancelLane,
  hasChildrenAtWork,
  laneOf,
  releaseLane,
  requestLane,
} from './delegation-lanes'

/**
 * A parent's children run at most `DELEGATION_SLOT_CAP` at once and the rest WAIT, first come first served.
 * The cap used to be a refusal, which handed the scheduling back to the model — and the model
 * mostly forgot the work instead of asking again.
 */

afterEach(() => __resetDelegationLanes())

/** The behaviour is the same at any cap: these tests pin it at three lanes to stay small. */
const THREE = { cap: 3 }

function recorder() {
  const started: string[] = []
  const ask = (child: string, parent = 'p') =>
    requestLane(parent, child, () => started.push(child), 'normal', THREE)
  return { started, ask }
}

describe('delegation lanes', () => {
  test('three run at once; the fourth waits and says where it stands', () => {
    const { started, ask } = recorder()
    expect(['a', 'b', 'c'].map((child) => ask(child))).toEqual([
      { state: 'running' },
      { state: 'running' },
      { state: 'running' },
    ])
    expect(ask('d')).toEqual({ state: 'queued', position: 1 })
    expect(ask('e')).toEqual({ state: 'queued', position: 2 })
    expect(started).toEqual(['a', 'b', 'c'])
  })

  test('a lane that frees goes to the one who waited longest', () => {
    const { started, ask } = recorder()
    for (const child of ['a', 'b', 'c', 'd', 'e']) ask(child)
    releaseLane('b')
    expect(started).toEqual(['a', 'b', 'c', 'd'])
    expect(laneOf('e')).toEqual({ state: 'queued', position: 1 })
    releaseLane('a')
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('the default pool is as wide as the delegation cap', () => {
    const started: string[] = []
    const answers = Array.from({ length: DELEGATION_SLOT_CAP + 2 }, (_, i) =>
      requestLane('p', `c${i}`, () => started.push(`c${i}`)),
    )
    expect(started).toHaveLength(DELEGATION_SLOT_CAP)
    expect(answers.filter((answer) => answer.state === 'queued')).toHaveLength(2)
  })

  test('the decision is synchronous, so a burst in one step cannot pass the cap', () => {
    // The incident that motivated the cap was one model step starting 154 runs: every one of
    // those calls must see the others before any of them awaits.
    const { started, ask } = recorder()
    const answers = Array.from({ length: 10 }, (_, i) => ask(`c${i}`))
    expect(started).toHaveLength(3)
    expect(answers.filter((answer) => answer.state === 'queued')).toHaveLength(7)
  })

  test('releasing twice frees one lane, not two', () => {
    const { started, ask } = recorder()
    for (const child of ['a', 'b', 'c', 'd', 'e']) ask(child)
    releaseLane('a')
    releaseLane('a')
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  test('a child already holding or awaiting a lane is not scheduled twice', () => {
    // Its later messages ride the run it already has or is about to get.
    const { started, ask } = recorder()
    for (const child of ['a', 'b', 'c', 'd']) ask(child)
    expect(ask('a')).toEqual({ state: 'running' })
    expect(ask('d')).toEqual({ state: 'queued', position: 1 })
    expect(started).toEqual(['a', 'b', 'c'])
  })

  test('a closed child leaves the queue without ever starting', () => {
    const { started, ask } = recorder()
    for (const child of ['a', 'b', 'c', 'd', 'e']) ask(child)
    expect(cancelLane('d')).toBe(true)
    releaseLane('a')
    expect(started).toEqual(['a', 'b', 'c', 'e'])
    expect(laneOf('d')).toBeUndefined()
  })

  test('each parent has its own lanes', () => {
    const { started, ask } = recorder()
    for (const child of ['a', 'b', 'c']) ask(child, 'p1')
    expect(ask('x', 'p2')).toEqual({ state: 'running' })
    expect(started).toEqual(['a', 'b', 'c', 'x'])
  })

  test('a higher priority waits ahead of a lower one; within a priority, first come first served', () => {
    const started: string[] = []
    const ask = (child: string, priority: 'high' | 'normal' | 'low') =>
      requestLane('p', child, () => started.push(child), priority, THREE)
    for (const child of ['a', 'b', 'c']) ask(child, 'normal')
    ask('low-1', 'low')
    ask('normal-1', 'normal')
    ask('high-1', 'high')
    ask('normal-2', 'normal')
    expect(laneOf('high-1')).toEqual({ state: 'queued', position: 1 })
    for (const child of ['a', 'b', 'c']) releaseLane(child)
    expect(started.slice(3)).toEqual(['high-1', 'normal-1', 'normal-2'])
    releaseLane('high-1')
    expect(started.at(-1)).toBe('low-1')
  })

  test('a running child is never pre-empted: a high priority takes the next free lane', () => {
    const started: string[] = []
    for (const child of ['a', 'b', 'c'])
      requestLane('p', child, () => started.push(child), 'low', THREE)
    requestLane('p', 'urgent', () => started.push('urgent'), 'high', THREE)
    expect(started).toEqual(['a', 'b', 'c'])
    releaseLane('b')
    expect(started).toEqual(['a', 'b', 'c', 'urgent'])
  })

  test('raising a waiting child priority moves it up the queue', () => {
    // A message that restates a task as urgent must reorder it, not leave it where it was.
    const started: string[] = []
    for (const child of ['a', 'b', 'c'])
      requestLane('p', child, () => started.push(child), 'normal', THREE)
    requestLane('p', 'first', () => started.push('first'), 'normal', THREE)
    requestLane('p', 'second', () => started.push('second'), 'normal', THREE)
    expect(requestLane('p', 'second', () => {}, 'high', THREE)).toEqual({
      state: 'queued',
      position: 1,
    })
    releaseLane('a')
    expect(started.at(-1)).toBe('second')
  })

  test('a start that throws gives its lane straight to the next', () => {
    const started: string[] = []
    requestLane('p', 'a', () => started.push('a'), 'normal', THREE)
    requestLane('p', 'b', () => started.push('b'), 'normal', THREE)
    requestLane('p', 'c', () => started.push('c'), 'normal', THREE)
    requestLane(
      'p',
      'boom',
      () => {
        throw new Error('no provider')
      },
      'normal',
      THREE,
    )
    requestLane('p', 'd', () => started.push('d'), 'normal', THREE)
    releaseLane('a')
    // `boom` got the lane, threw, and released it — `d` must not wait behind a dead start.
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  test('a workflow run has a pool of its own at its own cap, beside the chat’s own lanes', () => {
    // Claude Code runs up to 16 workflow agents at once; in the chat's pool they would run
    // at the chat's cap and keep the chat's own delegations queued behind the fan-out.
    const started: string[] = []
    const lane = { key: 'workflow:run-1', cap: 16 }
    const agents = Array.from({ length: 20 }, (_, i) => `w${i}`)
    for (const child of agents) requestLane('p', child, () => started.push(child), 'normal', lane)
    expect(started).toHaveLength(16)
    expect(laneOf('w16')).toEqual({ state: 'queued', position: 1 })
    expect(requestLane('p', 'delegated', () => started.push('delegated'))).toEqual({
      state: 'running',
    })
    // The parent's subtree is at work while its workflow pool holds agents.
    releaseLane('delegated')
    expect(hasChildrenAtWork('p')).toBe(true)
    releaseLane('w0')
    expect(started.at(-1)).toBe('w16')
    for (const child of agents) releaseLane(child)
    expect(hasChildrenAtWork('p')).toBe(false)
  })
})
