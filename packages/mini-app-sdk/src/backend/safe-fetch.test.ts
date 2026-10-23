import { afterAll, describe, expect, test } from 'bun:test'

import { checkUrlSafety } from './net-safety'
import { safeFetch } from './safe-fetch'

/**
 * `checkUrlSafety` reasons about ONE url. `fetch` follows redirects by default, so
 * the obvious composition — check, then fetch — lets a public host bounce the caller
 * into a private one, and the guard never sees the hop it was there to stop.
 *
 * The core's own web-fetch tool already follows redirects manually for exactly this
 * reason (`apps/api/src/features/agent-core/tools/web/research-fetch.ts:104`). This
 * is the same rule, available to mini apps, so a mini app author does not have to
 * rediscover it.
 */

/**
 * Real policy, with ONE exemption: the entry port is treated as public. An IP literal
 * never consults the resolver, so a loopback entry would be refused before any
 * redirect happened and the hop — the thing under test — would never be reached.
 */
const policyExempting = (entryPort: number | undefined) => async (url: URL) =>
  url.port === String(entryPort) ? null : await checkUrlSafety(url)

const internal = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => new Response('INTERNAL SECRET'),
})
const redirector = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () =>
    new Response(null, {
      status: 302,
      headers: { Location: `http://127.0.0.1:${internal.port}/` },
    }),
})
const ok = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('PUBLIC OK') })

afterAll(() => {
  void internal.stop()
  void redirector.stop()
  void ok.stop()
})

describe('safeFetch', () => {
  test('a redirect into a private address is refused, though the entry URL passes', async () => {
    const entry = `http://127.0.0.1:${redirector.port}/`
    const check = policyExempting(redirector.port)
    // The entry passes. That is the trap: `fetch` would follow the hop from here.
    expect(await check(new URL(entry))).toBeNull()

    const result = await safeFetch(entry, { check })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('private')
  })

  test('the same request with default redirect handling DOES reach the private body', async () => {
    // The behaviour being replaced, pinned so the fix cannot be quietly undone: a
    // plain fetch after a passing check retrieves the internal response.
    const res = await fetch(`http://127.0.0.1:${redirector.port}/`)
    expect(await res.text()).toBe('INTERNAL SECRET')
  })

  test('an ordinary response still comes back', async () => {
    const result = await safeFetch(`http://127.0.0.1:${ok.port}/`, {
      check: policyExempting(ok.port),
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(await result.response.text()).toBe('PUBLIC OK')
  })

  test('a private target is refused under the REAL policy, with no exemption', async () => {
    const result = await safeFetch(`http://127.0.0.1:${ok.port}/`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('private')
  })

  test('a redirect chain is bounded', async () => {
    // A host that redirects to itself forever must terminate, not spin.
    const loop = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) => new Response(null, { status: 302, headers: { Location: req.url } }),
    })
    try {
      const result = await safeFetch(`http://127.0.0.1:${loop.port}/`, {
        check: policyExempting(loop.port),
        maxRedirects: 3,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('redirect')
    } finally {
      void loop.stop()
    }
  })

  test('a non-http scheme is refused up front and after a redirect', async () => {
    const direct = await safeFetch('file:///etc/passwd')
    expect(direct.ok).toBe(false)

    const toFile = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response(null, { status: 302, headers: { Location: 'file:///etc/passwd' } }),
    })
    try {
      const hopped = await safeFetch(`http://127.0.0.1:${toFile.port}/`, {
        check: policyExempting(toFile.port),
      })
      expect(hopped.ok).toBe(false)
      if (!hopped.ok) expect(hopped.error).toContain('protocol')
    } finally {
      void toFile.stop()
    }
  })
})
