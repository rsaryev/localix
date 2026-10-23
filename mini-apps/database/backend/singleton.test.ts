/**
 * The live failure: the agent's `database_client` tool answered "Connected: MySQL Docker smoke
 * test", the saved-connection file on disk had the row, and the workbench list never showed it —
 * reload or not. The host re-wires a mini app by loading the new registration BEFORE unwiring the
 * old one; the new routes captured the instance the old `onShutdown` then released, and the next
 * agent turn built a second instance. These tests replay that order on the real `register()`.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { register } from './index'
import { releaseDatabaseService } from './singleton'

let dataDir: string
beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'localix-db-singleton-'))
})
afterAll(async () => {
  await releaseDatabaseService()
  await rm(dataDir, { recursive: true, force: true })
})

/** One `register()`: its route app (what the workbench calls) and its agent tool. */
async function registration() {
  const { backend, tools } = await register({ dataDir, userId: 'u', host: undefined })
  const subsystem = [backend ?? []].flat()[0]!
  const hono = new Hono()
  hono.route('/rpc/database', subsystem.routeMount!.app as never)
  const call = (method: 'GET' | 'POST', p: string, body?: unknown) =>
    hono.request(
      `/rpc/database${p}`,
      {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      { userId: 'u', projectId: '', cwd: dataDir },
    )
  const listed = async () =>
    ((await (await call('GET', '')).json()) as { connections: { name: string }[] }).connections
  return { call, listed, onShutdown: subsystem.onShutdown!, tool: tools![0]! }
}

test('a connection the agent adds after a mini app reload is on the list the workbench reads', async () => {
  const boot = await registration()
  expect(await boot.listed()).toEqual([]) // the list is now cached in memory

  // The host's reload: the NEW registration loads first, then the old one is unwired.
  const reloaded = await registration()
  await boot.onShutdown()

  // The next agent turn registers again and connects through its tool.
  const turn = await registration()
  const reply = await turn.tool.execute(
    'call-1',
    { action: 'connect', file: ':memory:', name: 'Agent SQLite' },
    undefined,
  )
  expect(JSON.stringify(reply)).toContain('Connected: Agent SQLite')

  expect((await reloaded.listed()).map(({ name }) => name)).toContain('Agent SQLite')
  // …and the workbench's own connects are not refused as "shutting down".
  const own = await reloaded.call('POST', '/connect', {
    config: { dialect: 'sqlite', file: ':memory:' },
    name: 'Workbench SQLite',
  })
  expect(own.status).toBe(200)
})

test('a release lets the next call build a fresh service that reopens saved entries', async () => {
  const first = await registration()
  const created = (await (
    await first.call('POST', '/connect', { config: { dialect: 'sqlite', file: ':memory:' } })
  ).json()) as { connection: { id: string } }
  await first.onShutdown()
  const next = await registration()
  const reopened = await next.call('POST', `/${created.connection.id}/reconnect`, {})
  expect(reopened.status).toBe(200)
})
