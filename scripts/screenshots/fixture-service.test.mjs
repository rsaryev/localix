import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ensureFixtureService } from './fixture-service.mjs'

const cleanup = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-http-capture-'))
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'release-studio')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Demo release</h1>')
  await fs.writeFile(path.join(root, 'release-status.json'), '{"status":"ready_for_review"}')
  await fs.writeFile(path.join(root, 'private.txt'), 'not part of the HTTP fixture')
  return { root, directory, port: 0 }
}

test('starts a loopback fixture, serves approved resources and closes its own listener', async () => {
  const options = await fixture()
  const service = await ensureFixtureService(options)
  cleanup.push(service.stop)
  expect(service.owned).toBe(true)
  expect(await (await fetch(`${service.origin}/release-status.json`)).json()).toEqual({
    status: 'ready_for_review',
  })
  expect(await (await fetch(service.origin)).text()).toContain('Demo release')
  expect((await fetch(`${service.origin}/private.txt`)).status).toBe(404)
  expect((await fetch(service.origin, { method: 'POST' })).status).toBe(405)
  service.stop()
  await expect(fetch(service.origin)).rejects.toThrow()
})

test('reuses only the identified fixture and leaves that listener alive when released', async () => {
  const options = await fixture()
  const owner = await ensureFixtureService(options)
  cleanup.push(owner.stop)
  const reused = await ensureFixtureService({
    ...options,
    port: Number(new URL(owner.origin).port),
  })
  expect(reused.owned).toBe(false)
  reused.stop()
  expect((await fetch(owner.origin)).status).toBe(200)
})

test('refuses an unrelated server without stopping or replacing it', async () => {
  const options = await fixture()
  const unrelated = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('another service'),
  })
  cleanup.push(() => unrelated.stop(true))
  await expect(ensureFixtureService({ ...options, port: unrelated.port })).rejects.toThrow(
    'belongs to another service',
  )
  expect(await (await fetch(`http://127.0.0.1:${unrelated.port}`)).text()).toBe('another service')
})

test('refuses to serve a root outside the designated capture directory', async () => {
  const options = await fixture()
  await expect(ensureFixtureService({ ...options, root: os.tmpdir() })).rejects.toThrow(
    'inside the isolated capture directory',
  )
})

test('starts on an explicitly selected free port after connection refusal', async () => {
  const options = await fixture()
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = reservation.port
  await reservation.stop(true)
  const service = await ensureFixtureService({ ...options, port })
  cleanup.push(service.stop)
  expect(service.owned).toBe(true)
  expect((await fetch(service.origin)).status).toBe(200)
})
