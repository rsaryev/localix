import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import path from 'node:path'

import { RAW_BODY_PARSE } from '../contracts/route-body-rule'
import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  type Exemptions,
} from './source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * A MUTATING ROUTE MUST NOT PARSE ITS BODY ITSELF.
 *
 * Every route in this app is reachable from any page the user's browser happens to be on. CORS
 * does not stop that — it stops the page READING the reply, which an attacker does not need: a
 * request that exfiltrates lands in their own logs. What actually stops a cross-origin write is
 * the PREFLIGHT, and a preflight only happens when the request is not "simple". A JSON
 * content-type makes it non-simple; `text/plain` does not.
 *
 * So the defence is exactly this:
 *
 *   zValidator('json', schema)   enforces the JSON content-type → forces a preflight → our CORS
 *                               (localhost-only) denies a hostile origin → the write never lands.
 *   c.req.json()                enforces NOTHING. It parses whatever arrived, so a `text/plain`
 *                               POST — a SIMPLE request, no preflight, delivered by every browser
 *                               — reaches the handler straight from a hostile page.
 *
 * MEASURED, not reasoned about (2026-07, while adding a plugin edit route). Against a
 * live Hono server: `c.req.json()` happily parsed a `{"url":"https://evil.example"}` body sent as
 * `text/plain`, `application/x-www-form-urlencoded` AND `multipart/form-data`. The same payload
 * through `zValidator('json')` got a 400 and never reached the handler.
 *
 * WHY THIS IS A GUARD AND NOT A COMMENT. The whole repo already does the right thing — 34 files
 * use zValidator and NOTHING calls `c.req.json()` in a route today. That is the property worth
 * freezing: it holds by CONVENTION, and a convention that protects credentials while looking like
 * a style preference is one refactor away from gone. The first author who reaches for
 * `c.req.json()` because "the schema is overkill for one field" removes a security control and
 * nothing anywhere says so. This test is the thing that says so.
 *
 * Same kit and same shape as `plugin-boundary-contract.test.ts` and `schemes.test.ts`: it reads
 * comment-stripped source, proves it opened something, and carries a planted positive control so
 * a green run means "no offender" and never "the detector quietly stopped matching".
 */

const ROOT = path.resolve(import.meta.dir, '..', '..', '..', '..')

/** Route surfaces: the host's own features, and every bundled plugin's backend. */
const INCLUDE = ['apps/api/src/features/**/*.ts', 'mini-apps/**/backend/**/*.ts']

/** The rule's own file, and tests, may name the call in prose or in a probe. */
const skipTests = (f: string): boolean => f.includes('.test.')

/** `c.req.json()` / `ctx.req.json()` — the un-enforced parse; `plugin_build` reads the same rule. */
const RAW_BODY_PARSE_RE = RAW_BODY_PARSE

/** Every `<file>::<call>` raw body parse under `root`. */
async function scanRawParses(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({ root, include: INCLUDE, skip: skipTests, minFiles })
  const hits: string[] = []
  for (const f of files) {
    for (const m of f.code.matchAll(RAW_BODY_PARSE_RE)) {
      hits.push(exemptionKey(f.file, m[0].replace(/\s+/g, '')))
    }
  }
  return hits
}

/**
 * No entries, and that is the point — this guard starts at ZERO and should stay there.
 *
 * An exemption here is not a formality: it is a route that reads attacker-controlled input with
 * no content-type enforcement, and it needs a reason explaining what ELSE stops a hostile page
 * from reaching it (its own origin check, a custom required header, a non-mutating handler).
 */
const EXEMPTIONS: Exemptions = {}

async function offendersIn(root: string, minFiles = 1): Promise<string[]> {
  return auditExemptions(EXEMPTIONS, await scanRawParses(root, minFiles)).offenders
}

describe('mutating routes must not parse their own body', () => {
  test('the detector really walks the route tree', async () => {
    // It should find NOTHING — so "it found nothing" has to be distinguished from "it opened
    // nothing". `scanSources` throws below minFiles, which is the assertion.
    const files = await scanSources({
      root: ROOT,
      include: INCLUDE,
      skip: skipTests,
      minFiles: 200,
    })
    expect(files.length).toBeGreaterThan(200)
    // And it is looking at real route code, not empty strings.
    expect(files.some((f) => f.code.includes('zValidator'))).toBe(true)
  })

  test('the detector fires on the real shape — and not on prose about it', async () => {
    // Reading a lint is not verifying it. This plants the bug ON DISK, in a tree the walker
    // really walks, and proves the SAME detector catches it; then proves the identical source,
    // commented out, stays silent — so this file's own header cannot satisfy the guard.
    await assertPositiveControl({
      subject: 'a route parsing its body with c.req.json() instead of zValidator',
      file: 'mini-apps/evil/backend/routes.ts',
      offender: [
        "import { Hono } from 'hono'",
        'export function createRoutes() {',
        "  return new Hono().put('/requests/:name', async (c) => {",
        '    const body = await c.req.json()',
        '    return c.json({ ok: body })',
        '  })',
        '}',
      ].join('\n'),
      detect: (root) => scanRawParses(root, 1),
    })
  })

  test('no route parses its own body — zValidator is the seam', async () => {
    const offenders = await offendersIn(ROOT, 200)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'A route reads its body with `c.req.json()`, which enforces NO content-type. A ' +
            'cross-origin `text/plain` POST is a SIMPLE request — no preflight, delivered by every ' +
            'browser — so this handler is reachable from any page the user is on, and CORS will ' +
            'not stop it (an attacker exfiltrating does not need to read the reply). Use ' +
            "`zValidator('json', schema)`: it enforces the JSON content-type, which forces the " +
            'preflight our localhost-only CORS denies. If this route is genuinely safe some other ' +
            'way, record it in EXEMPTIONS with the reason:\n  ' +
            offenders.join('\n  '),
    ).toEqual([])
  })

  test('no stale exemption', async () => {
    // An exemption that no longer matches anything is a claim about code that moved on.
    const audit = auditExemptions(EXEMPTIONS, await scanRawParses(ROOT, 200))
    expect(audit.stale, staleReport(audit.stale)).toEqual([])
  })

  test('the convention it protects is actually in use', async () => {
    // If zValidator vanished repo-wide, this guard would be green over a tree with no defence at
    // all — passing for the wrong reason.
    const files = await scanSources({
      root: ROOT,
      include: INCLUDE,
      skip: skipTests,
      minFiles: 200,
    })
    const withValidator = files.filter((f) => f.code.includes("zValidator('json'")).length
    assertNotVoid(
      "routes using zValidator('json')",
      withValidator,
      'No route validates a JSON body any more. Either the app stopped taking JSON bodies, or the ' +
        'defence this guard assumes is gone and its zero-offender result means nothing.',
    )
  })
})
