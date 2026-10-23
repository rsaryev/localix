import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { hc } from 'hono/client'
import { z } from 'zod'
import { routeValidator } from './route-validator'

const schema = z.object({ name: z.string().min(1), port: z.coerce.number().int() })

function appWith(options?: Parameters<typeof routeValidator>[0]) {
  const validated = routeValidator(options)
  return new Hono()
    .post('/json', validated('json', schema), (c) => c.json({ got: c.req.valid('json') }))
    .get('/query', validated('query', schema), (c) => c.json({ got: c.req.valid('query') }))
}

const post = (app: Hono, body: unknown) =>
  app.request('/json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('routeValidator', () => {
  test('a valid request reaches the handler with the PARSED value (coercions applied)', async () => {
    const res = await appWith().request('/query?name=db&port=5432')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ got: { name: 'db', port: 5432 } })
  })

  test('nested (default) is the jsonError envelope: headline + every field in detail', async () => {
    const res = await post(appWith(), { name: '' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string; detail: string } }
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toStartWith('name:')
    expect(body.error.detail).toContain('port')
    expect(JSON.stringify(body)).not.toContain('ZodError')
  })

  test('flat is { error, code, detail } with the mini app code', async () => {
    const res = await post(appWith({ envelope: 'flat', code: 'bad_request' }), { name: '' })
    const body = (await res.json()) as { error: string; code: string; detail: string }
    expect(typeof body.error).toBe('string')
    expect(body.code).toBe('bad_request')
    expect(body.detail).toContain('port')
  })

  test('text is a bare sentence naming every failed field — never an object', async () => {
    // An object here is what learning and external-agents shipped: "[object Object]" in the UI.
    const res = await post(appWith({ envelope: 'text' }), { name: '' })
    const body = (await res.json()) as { error: unknown }
    expect(typeof body.error).toBe('string')
    expect(body.error).toContain('(invalid: name, port)')
  })

  test('a typed hc client keeps the request types the schema declares', () => {
    const client = hc<ReturnType<typeof appWith>>('http://x')
    // Compile-time: `port` accepts the schema INPUT (coerce → unknown), `name` must be a string.
    void (() => client.json.$post({ json: { name: 'a', port: 1 } }))
    // @ts-expect-error — `name` is required by the schema.
    void (() => client.json.$post({ json: { port: 1 } }))
    expect(true).toBe(true)
  })
})
