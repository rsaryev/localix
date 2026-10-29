/**
 * The validator envelope, and the structural rule that keeps it the only one.
 *
 * The defect this guards is invisible at the call site: a bare `zValidator` compiles, serves traffic,
 * and only misbehaves on malformed input — where it answered `{success:false, error:ZodError}`, a body
 * outside the app's `{ error: { code, message } }` contract. `apps/ui` `unwrap()` reads
 * `error.error.message`, so the user saw the JSON dump of the Zod issue array with a null code.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { stripComments } from './source-lint'
import { zValidator } from './validator'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

const app = new Hono()
  .post('/json', zValidator('json', z.object({ name: z.string().min(1), port: z.number() })), (c) =>
    c.json({ ok: true }),
  )
  .get('/query', zValidator('query', z.object({ id: z.string().min(1) })), (c) =>
    c.json({ ok: true }),
  )

const post = (body: unknown) =>
  app.request('/json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('the validation failure body', () => {
  test('is the app envelope with a usable code — not the raw safeParse result', async () => {
    const res = await post({ name: '', port: 1 })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error?: { code?: string; message?: string } }
    expect(json.error?.code).toBe('validation_error')
    // The exact shape apps/ui `unwrap()` reads. A raw ZodError here is the whole defect.
    expect(typeof json.error?.message).toBe('string')
    expect(json).not.toHaveProperty('success')
    expect(JSON.stringify(json)).not.toContain('ZodError')
  })

  test('names the offending field and stays one line', async () => {
    const res = await post({ name: '', port: 1 })
    const message = ((await res.json()) as { error: { message: string } }).error.message
    expect(message).toStartWith('name:')
    // The old body was a 24-line JSON dump; a one-line message is the point.
    expect(message).not.toContain('\n')
  })

  test('a request failing several fields lists them all, so one retry is enough', async () => {
    const res = await post({ name: '' })
    const message = ((await res.json()) as { error: { message: string } }).error.message
    expect(message).toContain('name')
    expect(message).toContain('port')
  })

  test('a single-field failure does not append a redundant field list', async () => {
    const res = await post({ name: 'ok', port: 'nope' })
    const message = ((await res.json()) as { error: { message: string } }).error.message
    expect(message).toStartWith('port:')
    expect(message).not.toContain('(invalid:')
  })

  test('query targets get the same envelope as json targets', async () => {
    const res = await app.request('/query')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error')
  })

  test('a valid request still passes through untouched', async () => {
    const port = 8080 // a number to validate, never bound
    const res = await post({ name: 'ok', port })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

/** Every `.ts` under a root, excluding tests. */
function sources(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
    }
  }
  walk(root)
  return out
}

describe('only this module may import the raw validator', () => {
  const SRC = join(import.meta.dir, '..')
  const OWNER = join(SRC, 'lib', 'validator.ts')

  test('no other source file imports @hono/zod-validator', () => {
    const offenders = sources(SRC).filter(
      (file) => file !== OWNER && readFileSync(file, 'utf8').includes('@hono/zod-validator'),
    )
    // One missed file is one router leaking ZodError again, with nothing else to catch it.
    expect(offenders).toEqual([])
  })

  test('positive control: the owner really does import it, and routers really do validate', () => {
    // Without this, the check above would also pass if the app had stopped validating entirely.
    expect(readFileSync(OWNER, 'utf8')).toContain('@hono/zod-validator')
    const users = sources(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes("import { zValidator } from '"),
    )
    // A floor, not a census: it proves routers validate at all, so a router deleted with its
    // feature must not trip it (the workflows routes' removal left exactly 20).
    expect(users.length).toBeGreaterThan(15)
  })
})

/**
 * The same rule for the mini app SDK.
 *
 * Mini apps mount their own routers with their own error envelopes, so they cannot import the
 * host's validator. The rule has one owner on their side, the SDK's `routeValidator`, where an app
 * states only its envelope. So what must hold here is that owner: it formats through the shared
 * `summarizeZodIssues`. That no mini app touches a raw validator is checked where the mini apps
 * live.
 */
describe('the SDK owns the mini app router validator', () => {
  const ROOT = join(import.meta.dir, '..', '..', '..', '..')
  const SDK_OWNER = join(ROOT, 'packages/mini-app-sdk/src/backend/route-validator.ts')

  /** A raw validator is `@hono/zod-validator` or Hono's own `hono/validator` — either needs a hook. */
  const RAW = /['"](?:@hono\/zod-validator|hono\/validator)['"]/u

  test('the SDK owner formats every rejection through the shared formatter', () => {
    const code = stripComments(readFileSync(SDK_OWNER, 'utf8'))
    expect(code).toMatch(RAW)
    expect(code).toContain('summarizeZodIssues')
  })

  test('the detector fires on the import it exists to forbid', () => {
    expect(RAW.test("import { zValidator } from '@hono/zod-validator'")).toBe(true)
    expect(RAW.test("import { validator } from 'hono/validator'")).toBe(true)
  })
})
