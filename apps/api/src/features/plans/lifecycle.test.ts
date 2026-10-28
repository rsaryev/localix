import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { StoredSystemNotice } from '../../db/payload'
import type { AppDatabase } from '../../db/types'
import type { PermissionMode } from '../../contracts/permission-modes'
import { planCommentScope } from '../comments/contracts'
import { createCommentRepository } from '../comments/repository'
import { createPlanRepository } from './repository'
import { createPlanService } from './service'
import {
  createMemoryPlanFiles,
  withStoredVersions,
  type VersionedPlans,
} from '../../testing/plan-files-fixture'

/**
 * The plan lifecycle's promise: every transition writes exactly ONE conversation notice and moves
 * the version's attention item exactly once — and the mode switch an approval makes does not set
 * aside the very version being approved.
 */
let db: Kysely<AppDatabase>
let notices: string[]
let signals: string[]
let mode: PermissionMode
let plans: VersionedPlans

const owner = { userId: 'u1', sessionId: 'root' }
/** The person changing the mode through the session update path (which calls the hook). */
const setModeTo = async (next: PermissionMode) => {
  const before = mode
  mode = next
  if (before !== next) await plans.permissionModeChanged(owner, before, next)
}
const draft = (n: number) => ({ title: `Plan ${n}`, body: `## Goal\nStep ${n}` })

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 'root', user_id: 'u1', title: 'root' })
    .execute()
  notices = []
  signals = []
  mode = 'plan'
  plans = withStoredVersions(
    createPlanService({
      repo: createPlanRepository(db),
      comments: createCommentRepository(db),
      files: createMemoryPlanFiles().files,
      publish: () => undefined,
      // What the real host does: the session update path writes the mode, then calls the plans
      // service's mode hook (`SessionLifecycleCtx.onPermissionModeChanged`).
      setMode: async (who, next) => {
        const before = mode
        mode = next
        if (before !== next) await plans.permissionModeChanged(who, before, next)
      },
      wake: async () => ({ status: 'delivered' }),
      lifecycle: {
        notice: async (_owner, notice: StoredSystemNotice) => {
          notices.push(`${notice.kind}|${notice.text}`)
        },
        authorName: async () => 'lead',
        awaiting: (_owner, plan) => signals.push(`awaiting v${plan.version}`),
        settled: (_owner, planId, reason) => signals.push(`settled ${planId ?? '*'} ${reason}`),
        completed: (_owner, plan) => signals.push(`completed v${plan.version}`),
      },
    }),
  )
})
afterEach(() => destroyDatabase(db))

describe('one notice per transition', () => {
  test('present', async () => {
    await plans.present(owner, draft(1))
    expect(notices).toEqual(['plan_presented|lead presented plan v1: Plan 1.'])
    expect(signals).toEqual(['awaiting v1'])
  })

  test('request changes — counted comments, and the version stops waiting on the person', async () => {
    const v1 = await plans.present(owner, draft(1))
    for (const body of ['a', 'b'])
      await createCommentRepository(db).create({
        userId: 'u1',
        scope: planCommentScope(v1.id),
        anchor: {},
        body,
      })
    notices = []
    signals = []
    await plans.requestChanges(owner, v1.id, undefined)
    expect(notices).toEqual(['plan_changes_requested|Changes requested on plan v1 (2 comments).'])
    expect(signals).toEqual([`settled ${v1.id} answered`])
  })

  test('approve — marked approved before the mode moves, so leaving plan mode does not dismiss it', async () => {
    const v1 = await plans.present(owner, draft(1))
    notices = []
    signals = []
    const decision = await plans.approve(owner, v1.id, 'bypass')
    expect(decision.plan.status).toBe('approved')
    expect(mode).toBe('bypass')
    expect((await plans.approved(owner))?.id).toBe(v1.id)
    // No "set aside" line: the mode hook found nothing presented.
    expect(notices).toEqual(['plan_approved|Plan v1 approved — Bypass mode.'])
    expect(signals).toEqual([`settled ${v1.id} answered`, 'settled * superseded'])
  })

  test('dismiss', async () => {
    const v1 = await plans.present(owner, draft(1))
    notices = []
    signals = []
    await plans.dismiss(owner, v1.id)
    expect(notices).toEqual(['plan_dismissed|Plan v1 set aside.'])
    expect(signals).toEqual([`settled ${v1.id} dismissed`])
  })

  test('leaving plan mode with a version waiting sets it aside, once, with the auto line', async () => {
    const v1 = await plans.present(owner, draft(1))
    notices = []
    signals = []
    await plans.permissionModeChanged(owner, 'plan', 'default')
    await plans.permissionModeChanged(owner, 'default', 'bypass')
    expect((await plans.list(owner))[0]?.status).toBe('dismissed')
    expect(notices).toEqual([
      'plan_dismissed|Plan v1 set aside: the conversation left Plan mode without approving it.',
    ])
    expect(signals).toEqual([`settled ${v1.id} dismissed`])
  })

  test('an older version cannot be approved once the conversation left Plan mode', async () => {
    // Found by the mode matrix: v1 superseded by v2, leave Plan mode (v2 set aside), approve v1 —
    // it succeeded and switched the mode again behind the person's back.
    const v1 = await plans.present(owner, draft(1))
    await plans.present(owner, draft(2))
    await setModeTo('default')
    await expect(plans.approve(owner, v1.id, 'bypass')).rejects.toMatchObject({ status: 409 })
    expect(mode).toBe('default')
  })

  test('while a review is open an older version can still be chosen', async () => {
    const v1 = await plans.present(owner, draft(1))
    await plans.present(owner, draft(2))
    const decision = await plans.approve(owner, v1.id, 'default')
    expect(decision.plan.status).toBe('approved')
  })

  test('entering plan mode touches nothing', async () => {
    await plans.present(owner, draft(1))
    notices = []
    await plans.permissionModeChanged(owner, 'default', 'plan')
    expect(notices).toEqual([])
    expect((await plans.list(owner))[0]?.status).toBe('presented')
  })
})

describe('completing', () => {
  test('the approved plan becomes completed, with one notice and one journal signal', async () => {
    const v1 = await plans.present(owner, draft(1))
    await plans.approve(owner, v1.id, 'default')
    notices = []
    signals = []
    const done = await plans.complete(owner, 'Shipped the cache\nand the docs')
    expect(done).toMatchObject({
      status: 'completed',
      completionSummary: 'Shipped the cache\nand the docs',
    })
    expect(done.completedAt).not.toBeNull()
    expect(notices).toEqual(['plan_completed|Plan v1 completed: Shipped the cache'])
    expect(signals).toEqual(['completed v1'])
    // It leaves the system prompt: nothing is approved any more.
    expect(await plans.approved(owner)).toBeNull()
  })

  test('without an approved plan it is refused and says nothing', async () => {
    await plans.present(owner, draft(1))
    notices = []
    await expect(plans.complete(owner, 'done')).rejects.toMatchObject({ status: 409 })
    expect(notices).toEqual([])
  })

  test('the overview lists every version with its snapshot path', async () => {
    const v1 = await plans.present(owner, draft(1))
    await plans.approve(owner, v1.id, 'default')
    const { plans: versions } = await plans.overview(owner)
    expect(versions.map((plan) => [plan.status, plan.filePath])).toEqual([
      ['approved', '/work/project/.localix/plans/LOCALIX-1/v1.md'],
    ])
  })
})
