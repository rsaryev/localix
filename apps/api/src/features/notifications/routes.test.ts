import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createNotificationJournal } from './journal'
import { createNotificationRoutes } from './routes'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

async function harness() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const journal = createNotificationJournal({ db })
  const app = new Hono<AppContext>()
    .use(async (c, next) => {
      c.set('userId', c.req.header('x-user-id') ?? 'local-user')
      await next()
    })
    .route('/rpc/notifications', createNotificationRoutes(journal))
  return { app, journal }
}

const raise = (id: string) => ({
  id,
  op: 'raise',
  fact: {
    key: `client:${id}`,
    topic: 'application.notification',
    category: 'system',
    severity: 'error',
    title: 'Could not copy',
    origin: { kind: 'application' },
  },
})

describe('notification routes', () => {
  it('a server fact and a client op land in one inbox, read back by cursor', async () => {
    const { app, journal } = await harness()
    journal.record('local-user', {
      key: 'run:S1:m1',
      topic: 'run.failed',
      category: 'agent',
      severity: 'error',
      title: 'Agent run failed',
      origin: { kind: 'session', sessionId: 'S1', projectId: null },
    })
    await journal.flush()
    const first = await (await app.request('/rpc/notifications')).json()
    expect(first).toMatchObject({ full: true, changes: [{ entry: { key: 'run:S1:m1' } }] })

    const posted = await app.request('/rpc/notifications/ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [raise('a')] }),
    })
    expect(posted.status).toBe(200)
    const delta = await (await app.request(`/rpc/notifications?since=${first.cursor}`)).json()
    expect(delta).toMatchObject({ full: false, changes: [{ entry: { key: 'client:a' } }] })
  })

  it('a resent op is a no-op, and a malformed op is refused', async () => {
    const { app } = await harness()
    const post = (body: unknown) =>
      app.request('/rpc/notifications/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await (await post({ ops: [raise('b')] })).json()).changes).toHaveLength(1)
    expect((await (await post({ ops: [raise('b')] })).json()).changes).toEqual([])
    expect(
      (await post({ ops: [{ id: 'x', op: 'settle', fact: { reason: 'fixed' } }] })).status,
    ).toBe(400)
  })

  it('never serves one user another user’s inbox', async () => {
    const { app } = await harness()
    await app.request('/rpc/notifications/ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'a' },
      body: JSON.stringify({ ops: [raise('c')] }),
    })
    const other = await (
      await app.request('/rpc/notifications', { headers: { 'x-user-id': 'b' } })
    ).json()
    expect(other.changes).toEqual([])
  })
})
