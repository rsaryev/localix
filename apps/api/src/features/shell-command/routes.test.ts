import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Hono } from 'hono'
import { afterAll, describe, expect, test } from 'bun:test'

import type { AppContext } from '../../app'
import { createShellCommandService } from './service'
import { createShellCommandRoutes } from './routes'

const home = join(tmpdir(), `localix-shellcmd-routes-${randomUUID()}`)

function appFor(available = true) {
  const service = createShellCommandService({
    platform: 'linux',
    home,
    cliEntry: '/app/bin/localix.mjs',
    bunPath: '/usr/bin/bun',
    pathEnv: '/usr/bin',
    available,
  })
  const app = new Hono<AppContext>()
  app.route('/rpc/shell-command', createShellCommandRoutes(service))
  return app
}

describe('shell-command routes', () => {
  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  test('GET → status; POST install → installed; POST uninstall → not-installed', async () => {
    const app = appFor()

    const before = await app.request('/rpc/shell-command')
    expect(before.status).toBe(200)
    expect(await before.json()).toMatchObject({
      state: 'not-installed',
      available: true,
      onPath: false,
    })

    const installed = await app.request('/rpc/shell-command/install', { method: 'POST' })
    expect(installed.status).toBe(200)
    expect((await installed.json()).state).toBe('installed')

    const after = await app.request('/rpc/shell-command')
    expect((await after.json()).state).toBe('installed')

    const removed = await app.request('/rpc/shell-command/uninstall', { method: 'POST' })
    expect(removed.status).toBe(200)
    expect((await removed.json()).state).toBe('not-installed')
  })

  test('install on an unavailable runtime surfaces an error status', async () => {
    const app = appFor(false)
    const status = await app.request('/rpc/shell-command')
    expect((await status.json()).available).toBe(false)

    const res = await app.request('/rpc/shell-command/install', { method: 'POST' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
