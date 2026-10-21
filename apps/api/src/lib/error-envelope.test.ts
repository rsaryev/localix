/**
 * One error envelope for apps/api, enforced structurally.
 *
 * `jsonError` answers `{ error: { code, message } }` and `apps/ui`'s `unwrap()` reads
 * `error.error.message`. A route that writes a flat `{ error: '<reason>' }` instead still compiles,
 * still returns the right STATUS, and still looks correct in review — only the reason silently
 * becomes `undefined` on the client, which reports "Request failed with status N". That is invisible
 * at the call site, so it needs a check rather than a convention.
 *
 * Four such routes existed; two were dead-lettered messages nobody could see
 * (`upload_too_large`, `media_not_found`), and two were actionable sentences a user needed
 * (`No such file to serve: …`, `project scope needs a session with a working directory`).
 *
 * SCOPE IS apps/api ONLY. Bundled plugins deliberately answer their own flat
 * `{ error, code, detail }` contracts, each with a client written for it — see
 * `plugins/<name>/backend/routes.ts`.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { stripComments } from './source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

const SRC = join(import.meta.dir, '..')

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

/**
 * Matches `c.json({ error: '...' }` — a string literal (single, double or template) directly under
 * the `error` key.
 *
 * The backtick is written as \x60 rather than literally: a template-literal message is the same
 * defect and must be caught, but a bare backtick inside the pattern confuses the parser.
 */
const FLAT_ERROR_BODY = new RegExp(String.raw`\bc\.json\(\s*\{\s*error:\s*['"\x60]`)

describe('no route answers a flat error body', () => {
  test('every apps/api source uses jsonError instead', () => {
    const offenders = sources(SRC)
      .filter((file) => FLAT_ERROR_BODY.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })

  test('positive control: the pattern really matches the shape it is meant to catch', () => {
    // Without this the check above would pass on a broken regex, which is the same as no check.
    expect(FLAT_ERROR_BODY.test(`return c.json({ error: 'nope' }, 404)`)).toBe(true)
    expect(FLAT_ERROR_BODY.test('return c.json({ error: `no ${x}` }, 404)')).toBe(true)
    expect(FLAT_ERROR_BODY.test(`return c.json({ error: "nope" }, 400)`)).toBe(true)
    // …and does NOT flag the envelope or a non-error payload.
    expect(FLAT_ERROR_BODY.test(`return c.json({ error: { code, message } }, 400)`)).toBe(false)
    expect(FLAT_ERROR_BODY.test(`return c.json({ ok: true })`)).toBe(false)
    // A comment mentioning the old shape must not fail the build, hence stripComments above.
    expect(FLAT_ERROR_BODY.test(stripComments(`// c.json({ error: 'old' }, 404)`))).toBe(false)
  })

  test('positive control: the sweep really reads the tree', () => {
    const files = sources(SRC)
    expect(files.length).toBeGreaterThan(300)
    expect(files.some((f) => f.endsWith('features/media/routes.ts'))).toBe(true)
  })
})

/**
 * The narrower half of the same rule, applied to PLUGIN routers.
 *
 * Plugins own their envelopes — some flat `{error, code, detail}`, some the SDK's nested
 * `{error:{code,message}}` — so this cannot check the shape. What it CAN check is universal: the
 * `error` field must never hold a bare snake_case TOKEN, because that is a machine code sitting in the
 * slot a UI renders as the message.
 *
 * The guard covers every discovered plugin router, regardless of which plugin owns it.
 */
describe('no plugin route puts a machine code where the message goes', () => {
  const ROOT = join(import.meta.dir, '..', '..', '..', '..')
  const PLUGIN_ROOT = join(ROOT, 'plugins')

  /** `c.json({ error: '<snake_case_token>' }` — a bare identifier, not a sentence. */
  const BARE_CODE_BODY = new RegExp(String.raw`\bc\.json\(\s*\{\s*error:\s*'[a-z][a-z0-9_]*'\s*\}`)

  test('every plugin backend uses a real sentence', () => {
    const offenders = sources(PLUGIN_ROOT)
      .filter((file) => BARE_CODE_BODY.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(ROOT.length + 1))
    expect(offenders).toEqual([])
  })

  test('positive control: the pattern matches a bare code and spares a sentence', () => {
    expect(BARE_CODE_BODY.test(`return c.json({ error: 'connection_not_found' }, 404)`)).toBe(true)
    expect(BARE_CODE_BODY.test(`return c.json({ error: 'table_not_found' }, 404)`)).toBe(true)
    // A real message has spaces, so it is not a bare token…
    expect(BARE_CODE_BODY.test(`return c.json({ error: 'That table is gone.' }, 404)`)).toBe(false)
    // …and a body that also carries `code`/`detail` is the typed contract, not this defect.
    expect(BARE_CODE_BODY.test(`return c.json({ error: 'x', code: 'y', detail: 'z' }, 400)`)).toBe(
      false,
    )
  })

  test('positive control: the sweep really walked plugins/', () => {
    const files = sources(PLUGIN_ROOT)
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => f.includes(`${sep}backend${sep}`))).toBe(true)
  })
})
