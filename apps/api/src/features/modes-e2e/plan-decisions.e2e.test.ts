import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { PlanConflictError } from '../plans/conflict'
import { createPlanLifecycle, type PlanLifecycle } from './testing/plan-lifecycle-test-harness'

/**
 * A DECISION AGAINST A LIST THAT MAY BE STALE, through the wired lifecycle.
 *
 * The person's client had missed a `plan.updated` frame and still offered Approve on v1, which
 * the server had already approved: each click answered a red 409 and nothing corrected the list.
 * What must hold, read at every step:
 *
 *   - the same decision again is not an error: 200, the list as it is, nobody woken twice;
 *   - a conflicting decision is a 409 that CARRIES the list, so the client can correct itself;
 *   - `awaiting_person` is set only on a presented version — the raw column, not the reading;
 *   - the tab's cue (`plan.presented`) fires once per presentation or restore, and never for a
 *     decision.
 */
let life: PlanLifecycle
beforeEach(async () => {
  life = await createPlanLifecycle()
  await life.setMode('plan')
  life.drain()
})
afterEach(() => life.dispose())

const draft = (n: number) => ({ title: `Cache v${n}`, body: `## Goal\nStep ${n}` })

describe('repeating a decision', () => {
  test('approving twice in the same mode answers the list and wakes nobody again', async () => {
    const v1 = await life.plans.present(life.owner, draft(1))
    await life.plans.approve(life.owner, v1.id, 'autonomous')
    life.drain()

    const again = await life.plans.approve(life.owner, v1.id, 'autonomous')
    expect(again.wake).toBeNull()
    expect(again.plan).toMatchObject({ id: v1.id, status: 'approved', approvedMode: 'autonomous' })
    expect(again.plans.map((p) => `v${p.version} ${p.status}`)).toEqual(['v1 approved'])
    // No mode line, no approval line, no second wake.
    expect(life.drain()).toEqual([])
    expect(life.wakes.map((w) => w.source)).toEqual(['plan-approved'])
  })

  test('a conflicting decision is a 409 carrying every version as it is now', async () => {
    const v1 = await life.plans.present(life.owner, draft(1))
    await life.plans.approve(life.owner, v1.id, 'autonomous')
    life.drain()

    const refusal = await life.plans.approve(life.owner, v1.id, 'default').catch((e) => e)
    expect(refusal).toBeInstanceOf(PlanConflictError)
    expect(refusal).toMatchObject({ status: 409, message: 'Plan v1 is already approved' })
    expect((refusal as PlanConflictError).plans.map((p) => p.status)).toEqual(['approved'])

    const review = await life.plans.requestChanges(life.owner, v1.id, 'late').catch((e) => e)
    expect((review as PlanConflictError).plans.map((p) => p.id)).toEqual([v1.id])
    // Nothing moved: no line, no wake, the mode the approval chose.
    expect(life.drain()).toEqual([])
    expect(await life.modeOf(life.owner.sessionId)).toBe('autonomous')
  })

  test('dismissing a dismissed version answers it; dismissing a completed one conflicts', async () => {
    const v1 = await life.plans.present(life.owner, draft(1))
    await life.plans.dismiss(life.owner, v1.id)
    life.drain()
    const again = await life.plans.dismiss(life.owner, v1.id)
    expect(again.plan.status).toBe('dismissed')
    expect(life.drain()).toEqual([])

    const v2 = await life.plans.present(life.owner, draft(2))
    await life.plans.approve(life.owner, v2.id, 'default')
    await life.plans.complete(life.owner, 'done')
    const refusal = await life.plans.dismiss(life.owner, v2.id).catch((e) => e)
    expect(refusal).toBeInstanceOf(PlanConflictError)
    expect((refusal as PlanConflictError).plans.map((p) => p.status)).toEqual([
      'completed',
      'dismissed',
    ])
  })
})

describe('awaiting_person', () => {
  test('is set only on the presented version, through every transition', async () => {
    const v1 = await life.plans.present(life.owner, draft(1))
    expect(await life.awaitingFlags()).toEqual(['v1 presented awaiting=1'])

    // Superseded by v2.
    const v2 = await life.plans.present(life.owner, draft(2))
    expect(await life.awaitingFlags()).toEqual([
      'v2 presented awaiting=1',
      'v1 superseded awaiting=0',
    ])

    // Approved (the reported row: approved and still awaiting).
    await life.plans.approve(life.owner, v2.id, 'autonomous')
    expect(await life.awaitingFlags()).toEqual([
      'v2 approved awaiting=0',
      'v1 superseded awaiting=0',
    ])

    // Completed.
    await life.plans.complete(life.owner, 'done')
    expect(await life.awaitingFlags()).toEqual([
      'v2 completed awaiting=0',
      'v1 superseded awaiting=0',
    ])

    // Presented, dismissed by leaving Plan mode, restored by returning to it.
    await life.setMode('plan')
    const v3 = await life.plans.present(life.owner, draft(3))
    await life.setMode('default')
    expect((await life.awaitingFlags())[0]).toBe('v3 dismissed awaiting=0')
    await life.setMode('plan')
    expect((await life.awaitingFlags())[0]).toBe('v3 presented awaiting=1')

    // Dismissed by the person.
    await life.plans.dismiss(life.owner, v3.id)
    expect(await life.awaitingFlags()).toEqual([
      'v3 dismissed awaiting=0',
      'v2 completed awaiting=0',
      'v1 superseded awaiting=0',
    ])
    expect(v1.version).toBe(1)
  })
})

describe('the plan tab cue', () => {
  test('fires once per presentation or restore, and never for a decision', async () => {
    const v1 = await life.plans.present(life.owner, draft(1))
    expect(life.presentedCues.splice(0)).toEqual(['v1'])

    // The same draft again is `unchanged`: nothing was presented, nothing to open.
    expect((await life.service.present(life.owner, draft(1))).outcome).toBe('unchanged')
    expect(life.presentedCues.splice(0)).toEqual([])

    // Set aside by the mode, restored by the return to Plan mode: one cue for the restore.
    await life.setMode('default')
    await life.setMode('plan')
    expect(life.presentedCues.splice(0)).toEqual(['v1'])

    // Decisions are not presentations.
    await life.plans.approve(life.owner, v1.id, 'default')
    await life.plans.approve(life.owner, v1.id, 'default')
    await life.plans.dismiss(life.owner, v1.id)
    expect(life.presentedCues).toEqual([])
  })
})
