/**
 * WHAT STATUS DOES THE WORKBENCH ACTUALLY GET — measured end-to-end, through the real `sendRequest`.
 *
 * This file exists because per-function tests could not see the bug. `mapRestError` was tested,
 * `sendRequest` was tested, both passed, and the COMPOSITION was wrong: classification was
 * recovered by running regexes over the error's message, so every error whose wording did not
 * match a pattern in a different file silently became `502 network_error`. Three errors were added
 * to send.ts over three commits and none of them matched. Measured before the fix:
 *
 *   502 network_error   a timeout                     (should be 504)
 *   502 network_error   a url with no scheme          (should be 400 — the user's typo)
 *   502 network_error   a refused file:// url         (should be 403 — we blocked it)
 *   502 network_error   an unfilled :id               (should be 400)
 *   502 network_error   too many redirects            (should be 403)
 *
 * Seven of eight said "the upstream is broken" about a request the upstream never saw. So the
 * assertion here is deliberately the whole chain — throw → map → status — because that is the only
 * place the claim is true or false. A test of either half would have stayed green.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mapRestError, statusFor } from './errors'
import { sendRequest } from './send'
import type { RequestSpec } from './request-spec'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const OPTS = {
  timeoutMs: 5_000,
  maxBodyBytes: 10_000,
  allowPrivateNetwork: false,
  // Every test host is public; a stub keeps the address check off real DNS.
  resolveHost: async () => ['93.184.216.34'],
}
const spec = (over: Partial<RequestSpec>): RequestSpec => ({
  url: 'https://api.dev/x',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

/** A fetch that honours `signal` and answers the routes these cases need. */
function stub() {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input)
      if (url.includes('/slow')) {
        // Never answers: only the abort ends it.
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      } else if (url.includes('/loop')) {
        resolve(new Response(null, { status: 302, headers: { location: 'https://api.dev/loop' } }))
      } else if (url.includes('/meta')) {
        resolve(
          new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x' } }),
        )
      } else if (url.includes('/dead')) {
        reject(new TypeError('Unable to connect'))
      } else {
        resolve(new Response('ok'))
      }
    })) as unknown as typeof fetch
}

/** Send, and report the code+status the route would return. */
async function classify(
  over: Partial<RequestSpec>,
  opts: Partial<typeof OPTS> = {},
): Promise<{ code: string; status: number }> {
  stub()
  try {
    await sendRequest(spec(over), { ...OPTS, ...opts })
    throw new Error('expected a throw')
  } catch (err) {
    return { code: mapRestError(err).code, status: statusFor(err) }
  }
}

describe('every error a send can produce reaches the route correctly classified', () => {
  test.each([
    [
      'a timeout is 504 — the upstream did not answer in time',
      { url: 'https://api.dev/slow' },
      { timeoutMs: 60 },
      'timeout',
      504,
    ],
    [
      'a schemeless url is 400 — the request is wrong, not the server',
      { url: 'api.dev/x' },
      {},
      'bad_request',
      400,
    ],
    ['an unparseable url is 400', { url: 'not a url' }, {}, 'bad_request', 400],
    ['an unfilled :id is 400', { url: 'https://api.dev/u/:id' }, {}, 'bad_request', 400],
    [
      'a file:// url is 403 — well-formed, and we REFUSED it',
      { url: 'file:///etc/passwd' },
      {},
      'blocked',
      403,
    ],
    ['a redirect to a private address is 403', { url: 'https://api.dev/meta' }, {}, 'blocked', 403],
    ['too many redirects is 403', { url: 'https://api.dev/loop' }, {}, 'blocked', 403],
  ] as const)('%s', async (_label, over, opts, code, status) => {
    expect(await classify(over, opts)).toEqual({ code, status })
  })

  test('a GENUINE network failure is the only 502 left', async () => {
    // 502 means the upstream is broken. It should be rare, and it should be true.
    expect(await classify({ url: 'https://api.dev/dead' })).toEqual({
      code: 'network_error',
      status: 502,
    })
  })

  test('nothing a send throws is a 502 unless the network really failed', async () => {
    // The regression test for the whole class: if a future error forgets its code it lands here.
    const everything = await Promise.all([
      classify({ url: 'api.dev/x' }),
      classify({ url: 'not a url' }),
      classify({ url: 'https://api.dev/u/:id' }),
      classify({ url: 'file:///etc/passwd' }),
      classify({ url: 'https://api.dev/meta' }),
      classify({ url: 'https://api.dev/loop' }),
      classify({ url: 'https://api.dev/slow' }, { timeoutMs: 60 }),
    ])
    expect(everything.filter((e) => e.status === 502)).toEqual([])
  })
})
