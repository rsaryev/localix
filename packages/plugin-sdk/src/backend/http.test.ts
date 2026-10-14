/**
 * The Zod-issue summary, and the handler that must not fall back to `ZodError.message`.
 *
 * `ZodError.message` is `JSON.stringify(issues, null, 2)`. Both error envelopes here put their
 * message where a UI renders it, so shipping that string meant showing a wall of JSON with the real
 * reason buried inside. Every case below is driven from a REAL `safeParse` failure rather than a
 * hand-built issue array, because the shape of `issue.path` and the wording of `issue.message` are
 * Zod's to decide and a fixture would stop tracking them.
 */
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from './errors'
import { defaultErrorHandler, jsonBody, jsonError, summarizeZodIssues } from './http'

const failure = (schema: z.ZodType, value: unknown): z.ZodError => {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('fixture must fail to parse')
  return result.error
}

const user = z.object({ name: z.string().min(1), port: z.number() })

describe('summarizeZodIssues', () => {
  test('a single issue reads as "field: reason"', () => {
    const s = summarizeZodIssues(failure(user, { name: '', port: 1 }))
    expect(s.headline).toStartWith('name: ')
    expect(s.headline).not.toContain('\n')
    // No second field failed, so nothing is appended.
    expect(s.message).toBe(s.headline)
    expect(s.detail).toBe(s.headline)
  })

  test('several issues: headline stays one field, message names them all, detail lists them', () => {
    const s = summarizeZodIssues(failure(user, { name: '' }))
    expect(s.headline).toStartWith('name: ')
    expect(s.message).toContain('(invalid: name, port)')
    // A caller with a `detail` slot gets every reason, not just the first.
    expect(s.detail).toContain('name: ')
    expect(s.detail).toContain('port: ')
    expect(s.detail).toContain('; ')
  })

  test('a root-level failure has no field name to print and does not invent one', () => {
    const raw = failure(z.string(), 42)
    const s = summarizeZodIssues(raw)
    // No field prefix is prepended — Zod's own wording is the whole headline.
    expect(s.headline).toBe(raw.issues[0]!.message)
  })

  test('nested paths are dotted so the caller can find the field', () => {
    const nested = z.object({ db: z.object({ host: z.string() }) })
    const s = summarizeZodIssues(failure(nested, { db: {} }))
    expect(s.headline).toStartWith('db.host: ')
  })

  test('array indices appear in the path', () => {
    const list = z.object({ ports: z.array(z.number()) })
    const s = summarizeZodIssues(failure(list, { ports: [1, 'two'] }))
    expect(s.headline).toStartWith('ports.1: ')
  })

  test('a root failure is labelled (body) in the multi-field list, never blank', () => {
    // A union at the root can produce a pathless issue ALONGSIDE a field one; an empty name there
    // would render "(invalid: , name)".
    const s = summarizeZodIssues(failure(z.object({ a: z.string() }).strict(), { a: 1, b: 2 }))
    expect(s.message).not.toContain('invalid: ,')
    expect(s.message).not.toContain(', )')
  })

  test('never returns the raw JSON dump', () => {
    const raw = failure(user, { name: '' })
    const s = summarizeZodIssues(raw)
    // The defect, stated as an assertion: ZodError.message IS the dump.
    expect(raw.message).toContain('"code"')
    expect(s.message).not.toContain('"code"')
    expect(s.message).not.toContain('\n')
  })
})

describe('defaultErrorHandler', () => {
  const app = new Hono()
    .get('/parse', () => {
      user.parse({ name: '' })
      return new Response('unreachable')
    })
    .get('/api-error', () => {
      throw new ApiError(422, 'bad_sheet', 'That sheet could not be read.', 'invalid zip data')
    })
    .get('/ok', (c) => jsonError(c, 404, 'not_found', 'nope'))
  app.onError(defaultErrorHandler)

  test('a thrown ZodError becomes a readable envelope, not a JSON dump', async () => {
    const res = await app.request('/parse')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toStartWith('name: ')
    // This is the path that `.parse()` inside a route handler takes.
    expect(body.error.message).not.toContain('\n')
    expect(body.error.message).not.toContain('"origin"')
  })

  test('jsonError keeps its envelope, and omits detail when there is none', async () => {
    const res = await app.request('/ok')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'nope' } })
  })

  test('the message slot stays one sentence and every failing field reaches detail', async () => {
    const res = await app.request('/parse')
    const body = (await res.json()) as { error: { message: string; detail?: string } }
    // The headline names ONE field; the rest are not folded into the sentence any more.
    expect(body.error.message).toStartWith('name: ')
    expect(body.error.message).not.toContain('invalid:')
    expect(body.error.detail).toContain('name: ')
    expect(body.error.detail).toContain('port: ')
  })

  test('an ApiError carries its raw text into detail, beside the sentence', async () => {
    const res = await app.request('/api-error')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: {
        code: 'bad_sheet',
        message: 'That sheet could not be read.',
        detail: 'invalid zip data',
      },
    })
  })
})

/**
 * The body a route reads is the one that arrived as JSON — never one a page on another origin could
 * send without a preflight. Driven through a real Hono app, because the defect is in what reaches
 * the handler, not in what a helper returns.
 */
describe('jsonBody', () => {
  const reached: unknown[] = []
  const bodyApp = new Hono()
    .post('/strict', jsonBody(z.object({ note: z.string().min(1) })), (c) => {
      reached.push(c.req.valid('json'))
      return c.json({ ok: true })
    })
    // All-optional: `{}` passes the schema, so the content type is the only thing refusing it.
    .post('/loose', jsonBody(z.object({ first: z.boolean().optional() })), (c) => {
      reached.push(c.req.valid('json'))
      return c.json({ ok: true })
    })
  const post = (path: string, body: string, type: string) =>
    bodyApp.request(path, { method: 'POST', body, headers: { 'Content-Type': type } })

  test('a JSON body reaches the handler validated', async () => {
    reached.length = 0
    const res = await post('/strict', '{"note":"before the build"}', 'application/json')
    expect(res.status).toBe(200)
    expect(reached).toEqual([{ note: 'before the build' }])
  })

  test('a text/plain body — a simple, preflight-free request — never reaches it', async () => {
    reached.length = 0
    for (const path of ['/strict', '/loose']) {
      const res = await post(path, '{"note":"x","first":true}', 'text/plain')
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'json_required' } })
    }
    expect(reached).toEqual([])
  })

  test('an invalid JSON body is refused in the house envelope, one field per headline', async () => {
    const res = await post('/strict', '{"note":""}', 'application/json; charset=utf-8')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toStartWith('note: ')
  })
})
