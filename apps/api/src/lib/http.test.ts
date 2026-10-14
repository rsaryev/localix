import { describe, expect, test } from 'bun:test'
import type { Context } from 'hono'
import { jsonError } from './http'

function mockContext() {
  const calls: Array<{ payload: unknown; status: number }> = []
  const c = {
    json: (payload: unknown, status: number) => {
      calls.push({ payload, status })
      return { payload, status }
    },
  } as unknown as Context
  return { c, calls }
}

describe('jsonError', () => {
  test('wraps code + message in the standard { error: {...} } envelope and passes the status through', () => {
    const { c, calls } = mockContext()
    jsonError(c, 404, 'not_found', 'No such session')
    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe(404)
    expect(calls[0].payload).toEqual({ error: { code: 'not_found', message: 'No such session' } })
  })

  test('returns whatever c.json returns (so handlers can `return jsonError(...)`)', () => {
    const { c } = mockContext()
    // What's pinned here is PASS-THROUGH: jsonError hands back exactly what c.json
    // produced. The fake's c.json returns a plain marker object rather than Hono's
    // real Response, so widen to `unknown` (an assignment, not an assertion) instead
    // of claiming the marker is a JSONRespondReturn.
    const returned: unknown = jsonError(c, 500, 'internal', 'boom')
    expect(returned).toEqual({
      payload: { error: { code: 'internal', message: 'boom' } },
      status: 500,
    })
  })
})
