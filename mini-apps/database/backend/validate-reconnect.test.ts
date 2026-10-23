/**
 * The live failures seen in the running app: `POST /:id/validate` answered 500 and
 * `POST /:id/reconnect` answered 400 for a saved in-memory SQLite connection whose driver was
 * gone (the mini app backend had been reloaded). Real service, real SQLite driver, real routes.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { createDriver } from './drivers'
import { createDatabaseRoutes } from './routes'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'localix-db-live-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function app(storeDir = path.join(dir, `s-${Math.random()}`)) {
  const service = createDatabaseService({
    store: createConnectionStore({ dir: storeDir }),
    createDriver,
  })
  const hono = new Hono()
  hono.route('/rpc/database', createDatabaseRoutes(service) as never)
  const post = (p: string, body: unknown) =>
    hono.request(
      `/rpc/database${p}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { userId: 'u', projectId: '', cwd: dir },
    )
  return { service, post }
}

test('validate on a live in-memory SQLite connection answers per statement', async () => {
  const { post } = app()
  const connected = (await (
    await post('/connect', { config: { dialect: 'sqlite', file: ':memory:' } })
  ).json()) as { connection: { id: string } }
  const id = connected.connection.id
  const res = await post(`/${id}/validate`, { sql: 'SELEC * FROM users;\nSELECT 1;' })
  const body = await res.text()
  expect({ status: res.status, body }).toMatchObject({ status: 200 })
  expect(body).toContain('"ok":false')
})

test('a disconnected saved connection: validate is not a 500, reconnect reopens it', async () => {
  const { post } = app()
  const connected = (await (
    await post('/connect', { config: { dialect: 'sqlite', file: ':memory:' } })
  ).json()) as { connection: { id: string } }
  const id = connected.connection.id
  await post(`/${id}/disconnect`, {})
  const validate = await post(`/${id}/validate`, { sql: 'SELECT 1' })
  expect(validate.status).not.toBe(500)
  const reconnect = await post(`/${id}/reconnect`, {})
  expect({ status: reconnect.status, body: await reconnect.text() }).toMatchObject({ status: 200 })
})

test('after a backend reload (a NEW service over the same saved store) reconnect reopens it', async () => {
  const storeDir = path.join(dir, 'reload-store')
  const first = app(storeDir)
  const connected = (await (
    await first.post('/connect', { config: { dialect: 'sqlite', file: ':memory:' } })
  ).json()) as { connection: { id: string } }
  const second = app(storeDir)
  const reconnect = await second.post(`/${connected.connection.id}/reconnect`, {})
  expect({ status: reconnect.status, body: await reconnect.text() }).toMatchObject({ status: 200 })
})
