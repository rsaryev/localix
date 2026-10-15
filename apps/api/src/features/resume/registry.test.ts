import { describe, expect, it } from 'bun:test'

import type { StoredSystemNotice } from '../../db/payload'
import type { WakeRequest } from '../chat/contracts'
import type { SessionPlan } from '../plans/contracts'
import { planResumeProducer } from '../plans/resume-point'
import type { ResumePoint, ResumeProducer } from './contracts'
import { createResumeRegistry, isResumeConflict } from './registry'

const OWNER = { userId: 'u1', sessionId: 'LOCALIX-1' }

const approvedPlan = (over: Partial<SessionPlan> = {}): SessionPlan =>
  ({
    id: 'p1',
    sessionId: OWNER.sessionId,
    version: 2,
    status: 'approved',
    title: 'Landing page',
    body: '1. Build it',
    ...over,
  }) as SessionPlan

/** A registry over the given producers, recording what it wakes, says and pushes. */
function harness(producers: ResumeProducer[]) {
  const wakes: WakeRequest[] = []
  const notices: StoredSystemNotice[] = []
  const pushes: ResumePoint[][] = []
  const registry = createResumeRegistry({
    producers: () => producers,
    wake: async (request) => {
      wakes.push(request)
      return { status: 'delivered' } as never
    },
    notice: async (_owner, notice) => void notices.push(notice),
    publish: (_owner, points) => void pushes.push(points),
  })
  return { registry, wakes, notices, pushes }
}

describe('continuing an approved plan', () => {
  it('lists the approved version as the one point, keyed by its id', async () => {
    let plan: SessionPlan | null = approvedPlan()
    const { registry } = harness([planResumeProducer({ approved: async () => plan })])
    expect(await registry.list(OWNER)).toEqual([
      { key: 'plan:p1', kind: 'plan', title: 'Plan v2', detail: 'Landing page' },
    ])
    plan = null
    expect(await registry.list(OWNER)).toEqual([])
  })

  it('wakes the conversation with the plan in hand and says so once', async () => {
    const { registry, wakes, notices } = harness([
      planResumeProducer({ approved: async () => approvedPlan() }),
    ])
    const answer = await registry.resume(OWNER, 'plan:p1')

    expect(answer.wake).toBe('delivered')
    expect(wakes).toHaveLength(1)
    expect(wakes[0]).toMatchObject({
      sessionId: OWNER.sessionId,
      source: 'resume',
      // A double click while the first wake waits is the same request.
      deliveryKey: 'resume-point:plan:p1',
    })
    expect(wakes[0]!.content).toContain('continue implementing the approved plan v2')
    expect(wakes[0]!.content).toContain('1. Build it')
    expect(notices.map((notice) => notice.text)).toEqual(['Plan v2 continued.'])
  })

  it('a point that no longer holds is a 409 carrying the current list, and wakes nobody', async () => {
    // The person saw Continue on v2; the agent completed it meanwhile.
    const { registry, wakes } = harness([planResumeProducer({ approved: async () => null })])
    const error = await registry.resume(OWNER, 'plan:p1').catch((caught: unknown) => caught)
    expect(isResumeConflict(error)).toBe(true)
    expect((error as { points: ResumePoint[] }).points).toEqual([])
    expect(wakes).toEqual([])
  })

  it('a stale key for a replaced version does not continue the new one', async () => {
    const { registry, wakes } = harness([
      planResumeProducer({ approved: async () => approvedPlan({ id: 'p2', version: 3 }) }),
    ])
    const error = await registry.resume(OWNER, 'plan:p1').catch((caught: unknown) => caught)
    expect(isResumeConflict(error)).toBe(true)
    expect(wakes).toEqual([])
  })
})

describe('the registry, for any producer', () => {
  it('a key no producer owns is refused before anything happens', async () => {
    const { registry, wakes } = harness([])
    const error = await registry.resume(OWNER, 'job:bg-1').catch((caught: unknown) => caught)
    expect((error as { status: number }).status).toBe(400)
    expect(wakes).toEqual([])
  })

  it('one failing producer hides only its own points', async () => {
    const broken: ResumeProducer = {
      kind: 'job',
      list: async () => {
        throw new Error('unreadable')
      },
      take: async () => null,
    }
    const { registry } = harness([
      broken,
      planResumeProducer({ approved: async () => approvedPlan() }),
    ])
    expect((await registry.list(OWNER)).map((point) => point.key)).toEqual(['plan:p1'])
  })

  it('a change pushes the whole current list', async () => {
    const { registry, pushes } = harness([
      planResumeProducer({ approved: async () => approvedPlan() }),
    ])
    await registry.changed(OWNER)
    expect(pushes).toEqual([
      [{ key: 'plan:p1', kind: 'plan', title: 'Plan v2', detail: 'Landing page' }],
    ])
  })
})
