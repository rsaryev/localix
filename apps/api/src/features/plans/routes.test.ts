/**
 * The plans and comments routes over a real database: validation answers 400 in the app's error
 * envelope, and another user's plan or comment answers 404 as if it never existed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { planCommentScope } from '../comments/contracts'
import { createCommentRepository } from '../comments/repository'
import { createCommentRoutes } from '../comments/routes'
import { createPlanRepository } from './repository'
import { createPlanRoutes } from './routes'
import { createPlanService } from './service'
import { createMemoryPlanFiles } from '../../testing/plan-files-fixture'

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
  const comments = createCommentRepository(db)
  const wakes: string[] = []
  const modes: string[] = []
  const planFiles = createMemoryPlanFiles()
  const plans = createPlanService({
    repo: createPlanRepository(db),
    comments,
    files: planFiles.files,
    publish: () => {},
    setMode: async (_owner, mode) => {
      modes.push(mode)
    },
    wake: async (request) => {
      wakes.push(request.source)
      return { status: 'delivered' }
    },
    participants: async () => ['lead', 'backend'],
  })
  const app = new Hono<AppContext>()
    .use(async (c, next) => {
      c.set('userId', c.req.header('x-user-id') ?? 'u1')
      await next()
    })
    .route('/rpc', createPlanRoutes(plans))
    .route('/rpc/comments', createCommentRoutes(comments))
  const owner = { userId: 'u1', sessionId: 'root' }
  const { plan } = await plans.present(owner, 'lead', { title: 'Cache', body: '## Goal' })
  return { app, plan, wakes, modes, plans, owner, planFiles }
}

const json = (body: unknown, user = 'u1') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user-id': user },
  body: JSON.stringify(body),
})

describe('plan routes', () => {
  test('lists the versions of the caller’s conversation only', async () => {
    const { app } = await harness()
    const mine = (await (await app.request('/rpc/sessions/root/plans')).json()) as {
      plans: unknown[]
    }
    expect(mine.plans).toHaveLength(1)
    const theirs = await app.request('/rpc/sessions/root/plans', { headers: { 'x-user-id': 'u2' } })
    expect(((await theirs.json()) as { plans: unknown[] }).plans).toEqual([])
  })

  test('approve validates the mode — plan mode is not an implementation mode', async () => {
    const { app, plan, wakes } = await harness()
    const url = `/rpc/sessions/root/plans/${plan.id}/approve`
    const refused = await app.request(url, json({ mode: 'plan' }))
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'validation_error',
    )
    const stranger = await app.request(url, json({ mode: 'default' }, 'u2'))
    expect(stranger.status).toBe(404)
    const approved = await app.request(url, json({ mode: 'default' }))
    expect(approved.status).toBe(200)
    expect(wakes).toEqual(['plan-approved'])
  })

  test('approve takes an optional addressee from the roster; an empty one is a 400', async () => {
    const { app, plan, wakes } = await harness()
    const url = `/rpc/sessions/root/plans/${plan.id}/approve`
    expect((await app.request(url, json({ mode: 'default', to: '' }))).status).toBe(400)
    expect(wakes).toEqual([])
    const approved = await app.request(url, json({ mode: 'default', to: 'backend' }))
    expect(approved.status).toBe(200)
    expect(wakes).toEqual(['plan-approved'])
    expect((await app.request('/rpc/sessions/root/plans/executors')).status).toBe(404)
  })

  test('request-changes with nothing to send is a 400; dismiss of a wrong session is a 404', async () => {
    const { app, plan } = await harness()
    const review = await app.request(
      `/rpc/sessions/root/plans/${plan.id}/request-changes`,
      json({ note: '  ' }),
    )
    expect(review.status).toBe(400)
    const elsewhere = await app.request(`/rpc/sessions/other/plans/${plan.id}/dismiss`, json({}))
    expect(elsewhere.status).toBe(404)
  })

  test('the list carries the draft state and each version’s snapshot path', async () => {
    const { app, planFiles } = await harness()
    const read = async () =>
      (await (await app.request('/rpc/sessions/root/plans')).json()) as {
        plans: Array<{ filePath: string }>
        draft: { path: string; exists: boolean; changed: boolean }
      }
    const first = await read()
    expect(first.draft).toEqual({ path: planFiles.draftPath, exists: true, changed: false })
    expect(first.plans[0]!.filePath).toBe(`${planFiles.dir}/v1.md`)
    planFiles.writeDraft('## Goal\nAnd a second step')
    expect((await read()).draft.changed).toBe(true)
  })

  test('reopen brings back only the latest version set aside, and returns to Plan mode', async () => {
    const { app, plan, plans, owner, modes } = await harness()
    const reopen = (id: string) => app.request(`/rpc/sessions/root/plans/${id}/reopen`, json({}))
    // Still presented: the reopen already stands — 200 with the list, and the mode is untouched.
    const already = await reopen(plan.id)
    expect(already.status).toBe(200)
    expect(((await already.json()) as { plans: unknown[] }).plans).toHaveLength(1)
    expect(modes).toEqual([])
    await plans.dismiss(owner, plan.id)
    const reopened = await reopen(plan.id)
    expect(reopened.status).toBe(200)
    expect(((await reopened.json()) as { plan: { status: string; version: number } }).plan).toEqual(
      expect.objectContaining({ status: 'presented', version: 1 }),
    )
    expect(modes).toEqual(['plan'])
    // A newer version makes v1 no longer the latest: it cannot be reopened any more.
    await plans.dismiss(owner, plan.id)
    await plans.present(owner, 'lead', { body: '## Goal\nRevised' })
    expect((await reopen(plan.id)).status).toBe(409)
  })

  test('a decision repeated answers 200 with the list; a conflicting one 409 with the list', async () => {
    const { app, plan, wakes } = await harness()
    const approve = (mode: string) =>
      app.request(`/rpc/sessions/root/plans/${plan.id}/approve`, json({ mode }))
    type Answer = { wake?: string | null; plans: Array<{ id: string; status: string }> }
    expect((await approve('autonomous')).status).toBe(200)
    // The client that missed the frame clicks Approve again, in the same mode: it stands.
    const again = await approve('autonomous')
    expect(again.status).toBe(200)
    const repeated = (await again.json()) as Answer
    expect(repeated.wake).toBeNull()
    expect(repeated.plans.map((p) => p.status)).toEqual(['approved'])
    expect(wakes).toEqual(['plan-approved'])
    // A different mode on the approved version conflicts — and says what the versions are.
    const other = await approve('default')
    expect(other.status).toBe(409)
    const body = (await other.json()) as Answer & { error: { code: string; message: string } }
    expect(body.error).toEqual({ code: 'plan_decided', message: 'Plan v1 is already approved' })
    expect(body.plans).toEqual([expect.objectContaining({ id: plan.id, status: 'approved' })])
    // Request changes on a decided version: the same 409 shape.
    const review = await app.request(
      `/rpc/sessions/root/plans/${plan.id}/request-changes`,
      json({ note: 'too late' }),
    )
    expect(review.status).toBe(409)
    expect(((await review.json()) as Answer).plans).toHaveLength(1)
    // Dismissing twice: the second answers the dismissed version, not an error.
    const dismiss = () => app.request(`/rpc/sessions/root/plans/${plan.id}/dismiss`, json({}))
    expect((await dismiss()).status).toBe(200)
    const twice = await dismiss()
    expect(twice.status).toBe(200)
    expect(((await twice.json()) as Answer).plans.map((p) => p.status)).toEqual(['dismissed'])
  })
})

describe('comment routes', () => {
  test('create, list, edit, delete — scoped to the caller', async () => {
    const { app, plan } = await harness()
    const scope = planCommentScope(plan.id)
    const created = await app.request(
      '/rpc/comments',
      json({ scope, anchor: { quote: 'Goal', prefix: '', suffix: '' }, body: 'Why?' }),
    )
    expect(created.status).toBe(201)
    const { comment } = (await created.json()) as { comment: { id: string; status: string } }
    expect(comment.status).toBe('open')

    const listed = await app.request(`/rpc/comments?scope=${encodeURIComponent(scope)}`)
    expect(((await listed.json()) as { comments: unknown[] }).comments).toHaveLength(1)

    const patch = (body: unknown, user = 'u1') => ({ ...json(body, user), method: 'PATCH' })
    expect((await app.request(`/rpc/comments/${comment.id}`, patch({ body: 'How?' }))).status).toBe(
      200,
    )
    expect((await app.request(`/rpc/comments/${comment.id}`, patch({}))).status).toBe(400)
    expect(
      (await app.request(`/rpc/comments/${comment.id}`, patch({ status: 'outdated' }, 'u2')))
        .status,
    ).toBe(404)
    const del = (user: string) => ({ method: 'DELETE', headers: { 'x-user-id': user } })
    expect((await app.request(`/rpc/comments/${comment.id}`, del('u2'))).status).toBe(404)
    expect((await app.request(`/rpc/comments/${comment.id}`, del('u1'))).status).toBe(200)
  })

  test('a malformed scope or an oversized anchor is refused', async () => {
    const { app } = await harness()
    const bad = await app.request(
      '/rpc/comments',
      json({ scope: 'no-kind', anchor: {}, body: 'x' }),
    )
    expect(bad.status).toBe(400)
    const huge = await app.request(
      '/rpc/comments',
      json({ scope: 'plan:p', anchor: { quote: 'q'.repeat(5_000) }, body: 'x' }),
    )
    expect(huge.status).toBe(400)
  })
})
