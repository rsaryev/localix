import { describe, expect, spyOn, test } from 'bun:test'

import { LOCALIX_CLIENT_HEADER } from '@localixai/api/client'

import {
  ApiError,
  apiFetch,
  assertOk,
  cleanQuery,
  onApiRequestEvent,
  unwrap,
  withClientHeader,
} from './internal'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('cleanQuery', () => {
  test('drops undefined / null / empty-string, stringifies the rest', () => {
    expect(cleanQuery({ a: 1, b: undefined, c: null, d: '', e: 'x' })).toEqual({ a: '1', e: 'x' })
  })
  test('keeps 0 (falsy but meaningful) — only undefined/null/"" are dropped', () => {
    expect(cleanQuery({ n: 0, z: '0' })).toEqual({ n: '0', z: '0' })
  })
  test('no input → empty object', () => {
    expect(cleanQuery()).toEqual({})
  })
})

describe('unwrap', () => {
  test('returns the parsed JSON on ok', () => {
    expect(unwrap<{ v: number }>(json({ v: 7 }))).resolves.toEqual({ v: 7 })
  })

  test('applies the optional map', async () => {
    const out = await unwrap<{ v: number }>(json({ v: 7 }), (j) => ({ v: j.v * 2 }))
    expect(out).toEqual({ v: 14 })
  })

  test('throws ApiError with the server message + code on non-ok', () => {
    const res = json({ error: { code: 'NOPE', message: 'denied' } }, 403)
    expect(unwrap(res)).rejects.toMatchObject({
      name: 'Error',
      status: 403,
      code: 'NOPE',
      message: 'denied',
    })
  })

  test('classifies the status when the error body is unparseable, keeping the body as detail', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 500 })
    const err = (await unwrap(res).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
    // Was `Request failed with status 500`, which is what the user read.
    expect(err.message).toBe('The server could not complete this.')
    expect(err.detail).toBe('<html>502 Bad Gateway</html>')
    expect(err.code).toBeNull()
  })

  test("a route's own detail is kept as detail, nested or flat — the SDK reads both too", async () => {
    const nested = json(
      {
        error: {
          code: 'not_tabular',
          message: 'This sheet has no table in it.',
          detail: 'xlsx: no dimension node',
        },
      },
      400,
    )
    const fromNested = (await unwrap(nested).catch((e: unknown) => e)) as ApiError
    expect(fromNested.message).toBe('This sheet has no table in it.')
    expect(fromNested.detail).toBe('xlsx: no dimension node')
    expect(fromNested.code).toBe('not_tabular')

    const flat = json(
      {
        error: 'This sheet has no table in it.',
        code: 'not_tabular',
        detail: 'xlsx: no dimension node',
      },
      400,
    )
    const fromFlat = (await unwrap(flat).catch((e: unknown) => e)) as ApiError
    expect(fromFlat.message).toBe('This sheet has no table in it.')
    expect(fromFlat.detail).toBe('xlsx: no dimension node')
    expect(fromFlat.code).toBe('not_tabular')
  })

  test('a transport failure is a sentence, not `TypeError: Failed to fetch`', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    try {
      const err = (await apiFetch('http://localhost:5050/rpc/x').catch(
        (e: unknown) => e,
      )) as ApiError
      expect(err).toBeInstanceOf(ApiError)
      expect(err.message).toBe('Cannot reach the Localix server.')
      expect(err.detail).toBe('TypeError: Failed to fetch')
      expect(err.status).toBe(0)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('an abort still arrives unchanged — call sites match it by name', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(abort)
    try {
      expect(await apiFetch('http://localhost:5050/rpc/x').catch((e: unknown) => e)).toBe(abort)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('a machine code in the message slot is classified too, and demoted to detail', async () => {
    const res = json({ error: { code: 'NOPE', message: 'not_tabular' } }, 409)
    const err = (await unwrap(res).catch((e: unknown) => e)) as ApiError
    expect(err.message).toBe('Something else changed this first.')
    expect(err.detail).toContain('not_tabular')
    expect(err.code).toBe('NOPE')
  })
})

// The API refuses an Origin-less write without this header (a foreign page's `no-cors` POST looks
// exactly like that), so every write through the one transport must carry it.
describe('apiFetch client header', () => {
  const sentHeaders = async (input: RequestInfo | URL, init?: RequestInit) => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(json({}))
    try {
      await apiFetch(input, init)
      const [, sentInit] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined]
      return new Headers(sentInit?.headers)
    } finally {
      fetchSpy.mockRestore()
    }
  }

  test('a body-less POST and a DELETE carry it', async () => {
    for (const method of ['POST', 'DELETE']) {
      const headers = await sentHeaders('http://localhost:5050/rpc/x', { method })
      expect(headers.get(LOCALIX_CLIENT_HEADER)).toBe('1')
    }
  })

  test("keeps the caller's own headers next to it", async () => {
    const headers = await sentHeaders('http://localhost:5050/rpc/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    })
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get(LOCALIX_CLIENT_HEADER)).toBe('1')
  })

  test("a Request's own headers survive when no init headers replace them", async () => {
    const request = new Request('http://localhost:5050/rpc/x', {
      method: 'POST',
      headers: { 'x-user-id': 'u1' },
    })
    const headers = new Headers(withClientHeader(request, undefined, 'POST')?.headers)
    expect(headers.get('x-user-id')).toBe('u1')
    expect(headers.get(LOCALIX_CLIENT_HEADER)).toBe('1')
  })

  // A custom header on a cross-origin GET from the packaged page forces a preflight per read.
  test('a read is sent unchanged', async () => {
    const headers = await sentHeaders('http://localhost:5050/rpc/x')
    expect(headers.has(LOCALIX_CLIENT_HEADER)).toBe(false)
  })
})

describe('assertOk', () => {
  test('resolves on ok', () => {
    expect(assertOk(json({}, 204))).resolves.toBeUndefined()
  })
  test('throws ApiError on non-ok', () => {
    expect(assertOk(json({ error: { message: 'gone' } }, 404))).rejects.toMatchObject({
      status: 404,
      message: 'gone',
    })
  })
})

describe('apiFetch request observations', () => {
  test('emits a correlated lifecycle without leaking dynamic URL segments', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
    )
    const events: Parameters<Parameters<typeof onApiRequestEvent>[0]>[0][] = []
    const off = onApiRequestEvent((event) => events.push(event))
    try {
      await apiFetch('http://localhost:5050/rpc/secrets/private-key-name', { method: 'DELETE' })
      expect(events.map((event) => event.phase)).toEqual(['started', 'failed'])
      expect(events[0]).toMatchObject({
        traceId: events[1]?.traceId,
        operation: 'DELETE secrets',
        attributes: { path: '/rpc/secrets' },
      })
      expect(JSON.stringify(events)).not.toContain('private-key-name')
    } finally {
      off()
      fetchSpy.mockRestore()
    }
  })
})
