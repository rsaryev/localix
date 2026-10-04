import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import type { WakeRequest } from '../chat/contracts'
import type { WakeOutcome } from '../triggers/delivery'
import { planCommentScope } from '../comments/contracts'
import { createCommentRepository } from '../comments/repository'
import type { ImplementationMode, SessionPlan } from './contracts'
import { createPlanRepository } from './repository'
import { createPlanService } from './service'
import { createMemoryPlanFiles, withStoredVersions } from '../../testing/plan-files-fixture'

let db: Kysely<AppDatabase>
let wakes: WakeRequest[]
/** The root conversation's participant handles, as the host's `participants` port answers. */
let roster: string[]
let modes: Array<{ sessionId: string; mode: ImplementationMode }>
let pushes: SessionPlan[][]
let outcome: WakeOutcome

const owner = { userId: 'u1', sessionId: 'root' }
const draft = (n: number) => ({ title: `Plan ${n}`, body: `## Goal\nStep ${n}` })

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  for (const [id, user] of [
    ['root', 'u1'],
    ['other', 'u2'],
  ])
    await db
      .insertInto('agent_sessions')
      .values({ project_id: 'PRJ-test', id, user_id: user, title: id })
      .execute()
  wakes = []
  roster = ['lead']
  modes = []
  pushes = []
  outcome = { status: 'delivered' }
})
afterEach(() => destroyDatabase(db))

const comments = () => createCommentRepository(db)
const service = () =>
  withStoredVersions(
    createPlanService({
      repo: createPlanRepository(db),
      comments: comments(),
      files: createMemoryPlanFiles().files,
      publish: (_owner, plans) => pushes.push(plans),
      setMode: async ({ sessionId }, mode) => {
        modes.push({ sessionId, mode: mode as ImplementationMode })
      },
      wake: async (request) => {
        wakes.push(request)
        return outcome
      },
      participants: async () => roster,
    }),
  )

describe('presenting', () => {
  test('each presentation is the next version and supersedes the one still waiting', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    const v2 = await plans.present(owner, 'lead', draft(2))
    expect([v1.version, v2.version]).toEqual([1, 2])
    const list = await plans.list(owner)
    expect(list.map((plan) => [plan.version, plan.status])).toEqual([
      [2, 'presented'],
      [1, 'superseded'],
    ])
    // Every change pushes every version, newest first.
    expect(pushes.at(-1)!.map((plan) => plan.version)).toEqual([2, 1])
  })

  test("another user's session lists nothing and decides nothing", async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    expect(await plans.list({ userId: 'u2', sessionId: 'root' })).toEqual([])
    await expect(plans.dismiss({ userId: 'u2', sessionId: 'root' }, v1.id)).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('approving', () => {
  test('sets the mode, then wakes the author once with the body, keyed once-ever', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    const decision = await plans.approve(owner, v1.id, 'bypass')
    expect(decision.plan).toMatchObject({ status: 'approved', approvedMode: 'bypass' })
    expect(decision.wake).toBe('delivered')
    expect(modes).toEqual([{ sessionId: 'root', mode: 'bypass' }])
    expect(wakes).toHaveLength(1)
    expect(wakes[0]).toMatchObject({
      sessionId: 'root',
      source: 'plan-approved',
      deliveryKey: `plan:${v1.id}:approved`,
      receipt: true,
    })
    expect(wakes[0]!.content).toContain('Step 1')
    expect(wakes[0]!.content).toContain('Bypass')
    // A second approval is refused, and wakes nobody.
    await expect(plans.approve(owner, v1.id, 'default')).rejects.toMatchObject({ status: 409 })
    expect(wakes).toHaveLength(1)
    expect(await plans.approved(owner)).toMatchObject({ id: v1.id })
  })

  test('approving an older version supersedes the newer one waiting and the earlier approval', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await plans.approve(owner, v1.id, 'default')
    const v2 = await plans.present(owner, 'lead', draft(2))
    const v3 = await plans.present(owner, 'lead', draft(3))
    await plans.approve(owner, v2.id, 'autonomous')
    const status = Object.fromEntries((await plans.list(owner)).map((p) => [p.id, p.status]))
    expect(status).toEqual({ [v1.id]: 'superseded', [v2.id]: 'approved', [v3.id]: 'superseded' })
  })
})

describe('the approval is addressed to whom the person chose', () => {
  test('no addressee: the conversation strategy picks its default answerer', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await plans.approve(owner, v1.id, 'default')
    expect(wakes[0]!.to).toBeUndefined()
    expect(wakes[0]!.addressedAs).toBe('')
  })

  test('a chosen participant travels as the `@handle` the conversation routes by', async () => {
    roster = ['lead', 'backend']
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await plans.approve(owner, v1.id, 'bypass', 'Backend')
    // Canonical spelling, and still no `to`: routing stays the conversation strategy's.
    expect(wakes[0]).toMatchObject({ addressedAs: '@backend' })
    expect(wakes[0]!.to).toBeUndefined()
    // Nothing on the plan names an implementer: the version is the conversation's.
    expect(Object.keys(pushes.at(-1)![0]!).some((key) => /executor/i.test(key))).toBe(false)
  })

  test('`all` travels as `@all`', async () => {
    roster = ['lead', 'backend']
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await plans.approve(owner, v1.id, 'default', 'all')
    expect(wakes[0]).toMatchObject({ addressedAs: '@all' })
  })

  test('a handle not in the conversation is a 400, and nothing is decided', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await expect(plans.approve(owner, v1.id, 'bypass', 'ghost')).rejects.toMatchObject({
      status: 400,
      code: 'unknown_participant',
    })
    expect(wakes).toEqual([])
    expect(modes).toEqual([])
    expect((await plans.list(owner))[0]!.status).toBe('presented')
  })
})

describe('what a boot rebuilds attention from', () => {
  const awaiting = async () =>
    (await createPlanRepository(db).listAwaitingReview()).map((plan) => plan.version)

  test('a version restored after a review round waits on the person again', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    expect(await awaiting()).toEqual([1])
    await plans.requestChanges(owner, v1.id, 'smaller')
    expect(await awaiting()).toEqual([])
    // Set aside, then reopened: the same version under review again, its round count kept.
    await plans.dismiss(owner, v1.id)
    await plans.reopen(owner, v1.id)
    expect(await awaiting()).toEqual([1])
    // …so the next round's delivery key is still a new one.
    await plans.requestChanges(owner, v1.id, 'again')
    expect(wakes.at(-1)!.deliveryKey).toBe(`plan:${v1.id}:review:2`)
    expect(await awaiting()).toEqual([])
  })

  test('an undelivered review leaves the version waiting', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    outcome = { status: 'failed', detail: 'store down' }
    await plans.requestChanges(owner, v1.id, 'smaller')
    expect(await awaiting()).toEqual([1])
  })
})

describe('requesting changes', () => {
  test('sends the open comments, marks them sent, and keys each round once', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    const scope = planCommentScope(v1.id)
    await comments().create({ userId: 'u1', scope, anchor: { quote: 'Step 1' }, body: 'Why?' })
    const result = await plans.requestChanges(owner, v1.id, 'Keep it small')
    expect(result).toMatchObject({ comments: 1, wake: 'delivered' })
    expect(wakes[0]).toMatchObject({
      source: 'plan-review',
      deliveryKey: `plan:${v1.id}:review:1`,
      receipt: true,
    })
    expect(wakes[0]!.content).toContain('On "Step 1":\nWhy?')
    expect(wakes[0]!.content).toContain('Keep it small')
    expect((await comments().list('u1', scope)).map((c) => c.status)).toEqual(['sent'])

    // The next round is a different delivery; nothing open and no note is refused.
    await plans.requestChanges(owner, v1.id, 'One more thing')
    expect(wakes[1]!.deliveryKey).toBe(`plan:${v1.id}:review:2`)
    await expect(plans.requestChanges(owner, v1.id, undefined)).rejects.toMatchObject({
      status: 400,
    })
  })

  test('an undelivered review puts its comments back on the plan', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    const scope = planCommentScope(v1.id)
    await comments().create({ userId: 'u1', scope, anchor: {}, body: 'Split step 2' })
    outcome = { status: 'failed', detail: 'store down' }
    expect((await plans.requestChanges(owner, v1.id, undefined)).wake).toBe('failed')
    expect((await comments().list('u1', scope)).map((c) => c.status)).toEqual(['open'])
  })

  test('only the version under review takes changes', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await plans.present(owner, 'lead', draft(2))
    await expect(plans.requestChanges(owner, v1.id, 'late')).rejects.toMatchObject({ status: 409 })
  })
})

describe('dismissing and deleting', () => {
  test('dismiss wakes nobody, and an approved plan can be put aside as done', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    expect((await plans.dismiss(owner, v1.id)).plan.status).toBe('dismissed')
    const v2 = await plans.present(owner, 'lead', draft(2))
    await plans.approve(owner, v2.id, 'default')
    await plans.dismiss(owner, v2.id)
    expect(await plans.approved(owner)).toBeNull()
    expect(wakes.map((w) => w.source)).toEqual(['plan-approved'])
  })

  test('a deleted session takes its plans, and a deleted plan its comments', async () => {
    const plans = service()
    const v1 = await plans.present(owner, 'lead', draft(1))
    await comments().create({ userId: 'u1', scope: planCommentScope(v1.id), anchor: {}, body: 'x' })
    await comments().create({ userId: 'u1', scope: 'file:/a.ts', anchor: {}, body: 'kept' })
    await db.deleteFrom('agent_sessions').where('id', '=', 'root').execute()
    expect(await plans.list(owner)).toEqual([])
    const left = await db.selectFrom('comments').select('scope').execute()
    expect(left).toEqual([{ scope: 'file:/a.ts' }])
  })
})
