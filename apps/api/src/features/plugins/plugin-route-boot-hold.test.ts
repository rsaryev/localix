import { describe, expect, test } from 'bun:test'
import { Hono, type MiddlewareHandler } from 'hono'

import { holdMiniAppRoutesUntilWired } from './plugin-route-boot-hold'

/**
 * A backend host shaped like the real one: a mutable mount table the dispatcher reads per
 * request, and a first reconcile the test finishes by hand (wiring `routes` as it does).
 */
function fakeHost() {
  const mounts = new Map<string, Hono>()
  let done = false
  let finish: () => void = () => {}
  const settled = new Promise<void>((resolve) => (finish = resolve))
  const middleware = (): MiddlewareHandler => async (c, next) => {
    for (const [prefix, app] of mounts) {
      if (c.req.path === prefix || c.req.path.startsWith(`${prefix}/`)) {
        return app.fetch(new Request(new URL(c.req.path.slice(prefix.length) || '/', c.req.url)))
      }
    }
    return next()
  }
  return {
    host: { middleware, firstReconcile: { done: () => done, settled } },
    wire: (prefix: string) => {
      mounts.set(
        prefix,
        new Hono().get('/status', (c) => c.json({ plugin: true })),
      )
      done = true
      finish()
    },
  }
}

function appWith(host: ReturnType<typeof fakeHost>['host'], waitMs?: number) {
  const app = new Hono()
  app.use('*', holdMiniAppRoutesUntilWired(host, waitMs))
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}

// Every plugin call in the first seconds of a launch got a 404 and read it as "not here".
describe('plugin routes before the first reconcile', () => {
  test('a plugin request waits for the wiring instead of reading 404', async () => {
    const { host, wire } = fakeHost()
    const app = appWith(host)
    const pending = app.request('/rpc/example-plugin/status')
    setTimeout(() => wire('/rpc/example-plugin'), 20)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plugin: true })
  })

  test('a core route never waits for the plugins', async () => {
    const { host } = fakeHost()
    const started = performance.now()
    const response = await appWith(host).request('/health')
    expect(response.status).toBe(200)
    expect(performance.now() - started).toBeLessThan(50)
  })

  test('after the first reconcile an unknown path is a 404 at once', async () => {
    const { host, wire } = fakeHost()
    wire('/rpc/example-plugin')
    const started = performance.now()
    expect((await appWith(host).request('/rpc/nothing-here')).status).toBe(404)
    expect(performance.now() - started).toBeLessThan(50)
  })

  test('the wait is bounded: a reconcile that never comes still ends in the 404', async () => {
    const { host } = fakeHost()
    const started = performance.now()
    expect((await appWith(host, 40).request('/rpc/example-plugin/status')).status).toBe(404)
    expect(performance.now() - started).toBeGreaterThanOrEqual(35)
  })
})
