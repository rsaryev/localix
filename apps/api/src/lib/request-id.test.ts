import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { assignRequestId, rejectionFacts, requestIdOf, stampRequestId } from './request-id'

describe('request id', () => {
  test('every answer carries one, and the handler can read the same id', async () => {
    const app = new Hono()
    let seen: string | undefined
    app.use('*', async (c, next) => {
      const id = assignRequestId(c)
      await next()
      stampRequestId(c, id)
    })
    app.get('/x', (c) => {
      seen = requestIdOf(c)
      return c.json({ ok: true })
    })
    const response = await app.request('/x')
    expect(response.headers.get('x-request-id')).toBe(seen!)
    expect(seen).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('rejectionFacts — what a rejected answer said, for the log line', () => {
  // The defect: a plugin route answered its own typed body, so the API log had only
  // `GET /rpc/<plugin>/containers 400` — no code, no detail, nothing to diagnose.
  test("a plugin's flat envelope", async () => {
    const response = Response.json(
      { error: 'Docker is not available', code: 'engine_unavailable', detail: 'dial unix …' },
      { status: 503 },
    )
    expect(await rejectionFacts(response)).toEqual({
      code: 'engine_unavailable',
      message: 'Docker is not available',
      detail: 'dial unix …',
    })
  })

  test("the host's nested envelope", async () => {
    const response = Response.json(
      { error: { code: 'not_a_repo', message: 'No repository.' } },
      { status: 404 },
    )
    expect(await rejectionFacts(response)).toMatchObject({
      code: 'not_a_repo',
      message: 'No repository.',
    })
  })

  test('never buffers a body that is not JSON, and leaves the original readable', async () => {
    expect(await rejectionFacts(new Response('nope', { status: 500 }))).toBeNull()
    const json = Response.json({ error: 'x', code: 'y' }, { status: 400 })
    await rejectionFacts(json)
    expect(await json.json()).toEqual({ error: 'x', code: 'y' })
  })
})
