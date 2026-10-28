/**
 * "Continue" over a real database and the real plan service: an approved plan is offered, its
 * Continue wakes the conversation, another user sees nothing, and a plan finished meanwhile
 * answers 409 with the current (empty) list — the body the client replaces its button from.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCommentRepository } from '../comments/repository'
import { createPlanRepository } from '../plans/repository'
import { planResumeProducer } from '../plans/resume-point'
import { createPlanService } from '../plans/service'
import { createMemoryPlanFiles } from '../../testing/plan-files-fixture'
import { createResumeRegistry } from './registry'
import { createResumeRoutes } from './routes'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

async function harness() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 'root', user_id: 'u1', title: 'root' })
    .execute()
  const wakes: string[] = []
  const wake = async (request: { source: string }) => {
    wakes.push(request.source)
    return { status: 'delivered' as const }
  }
  const plans = createPlanService({
    repo: createPlanRepository(db),
    comments: createCommentRepository(db),
    files: createMemoryPlanFiles().files,
    publish: () => {},
    setMode: async () => {},
    wake,
  })
  const resume = createResumeRegistry({
    producers: () => [planResumeProducer(plans)],
    wake,
    notice: async () => {},
    publish: () => {},
  })
  const app = new Hono<AppContext>()
    .use(async (c, next) => {
      c.set('userId', c.req.header('x-user-id') ?? 'u1')
      await next()
    })
    .route('/rpc', createResumeRoutes(resume))
  const owner = { userId: 'u1', sessionId: 'root' }
  const { plan } = await plans.present(owner, { title: 'Cache', body: '## Goal' })
  return { app, plan, plans, owner, wakes }
}

const post = (app: Hono<AppContext>, key: string, user = 'u1') =>
  app.request('/rpc/sessions/root/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': user },
    body: JSON.stringify({ key }),
  })

describe('/rpc/sessions/:id/resume', () => {
  test('a presented plan is not unfinished work; an approved one is', async () => {
    const { app, plan, plans, owner } = await harness()
    expect(await (await app.request('/rpc/sessions/root/resume')).json()).toEqual({ points: [] })

    await plans.approve(owner, plan.id, 'default')
    expect(await (await app.request('/rpc/sessions/root/resume')).json()).toEqual({
      points: [{ key: `plan:${plan.id}`, kind: 'plan', title: 'Plan v1', detail: 'Cache' }],
    })
  })

  test('Continue wakes the conversation and answers the list as it is now', async () => {
    const { app, plan, plans, owner, wakes } = await harness()
    await plans.approve(owner, plan.id, 'default')
    wakes.length = 0

    const response = await post(app, `plan:${plan.id}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { wake: string; points: unknown[] }
    expect(body.wake).toBe('delivered')
    // Still unfinished: Continue only asked the agent to go on.
    expect(body.points).toHaveLength(1)
    expect(wakes).toEqual(['resume'])
  })

  test('another user sees nothing and cannot continue it', async () => {
    const { app, plan, plans, owner, wakes } = await harness()
    await plans.approve(owner, plan.id, 'default')
    wakes.length = 0

    const listed = await app.request('/rpc/sessions/root/resume', {
      headers: { 'x-user-id': 'u2' },
    })
    expect(await listed.json()).toEqual({ points: [] })
    expect((await post(app, `plan:${plan.id}`, 'u2')).status).toBe(409)
    expect(wakes).toEqual([])
  })

  test('a plan finished meanwhile answers 409 with the current list', async () => {
    const { app, plan, plans, owner, wakes } = await harness()
    await plans.approve(owner, plan.id, 'default')
    await plans.complete(owner, 'Done')
    wakes.length = 0

    const response = await post(app, `plan:${plan.id}`)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'resume_point_gone',
        message: 'This work is no longer waiting to be continued',
      },
      points: [],
    })
    expect(wakes).toEqual([])
  })
})
