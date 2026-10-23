/**
 * The history ring's claims: newest first, capped, per user × request, and a rename carries the
 * entries while a delete drops them. State is process-global, so each test uses its own names.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import type { SendResponse } from './contracts'
import type { RequestSpec } from './request-spec'
import {
  HISTORY_LIMITS,
  dropHistory,
  listHistory,
  recordSend,
  renameHistory,
  resetHistory,
} from './history'

// The ring is process-wide state on `globalThis` (see history.ts) — leaving it behind fails the
// run-wide globals guard and changes what every later test file sees.
afterAll(resetHistory)

const res = (status: number): SendResponse => ({
  status,
  statusText: 'OK',
  url: 'https://api.dev',
  headers: {},
  body: '',
  bytes: 0,
  truncated: false,
  elapsedMs: 1,
  hops: [{ url: 'https://api.dev', status, elapsedMs: 1 }],
})

describe('response history', () => {
  test('newest first, capped at 10', () => {
    for (let i = 1; i <= 12; i++) recordSend('u1', 'ring', res(200 + i), 'user')
    const entries = listHistory('u1', 'ring')
    expect(entries).toHaveLength(10)
    expect(entries[0].response.status).toBe(212)
    expect(entries[9].response.status).toBe(203)
  })

  test('keyed per user and per request', () => {
    recordSend('u1', 'a', res(200), 'user')
    recordSend('u2', 'a', res(500), 'user')
    expect(listHistory('u1', 'a')[0].response.status).toBe(200)
    expect(listHistory('u2', 'a')[0].response.status).toBe(500)
    expect(listHistory('u1', 'other')).toEqual([])
  })

  test('the same request name has an independent ring in each session', () => {
    recordSend('u-session', 'health', res(200), 'user', undefined, 'session-a')
    recordSend('u-session', 'health', res(503), 'user', undefined, 'session-b')
    expect(listHistory('u-session', 'health', 'session-a')[0].response.status).toBe(200)
    expect(listHistory('u-session', 'health', 'session-b')[0].response.status).toBe(503)
  })

  test('rename carries history; delete drops it', () => {
    recordSend('u1', 'before', res(201), 'user')
    renameHistory('u1', 'before', 'after')
    expect(listHistory('u1', 'before')).toEqual([])
    expect(listHistory('u1', 'after')[0].response.status).toBe(201)

    dropHistory('u1', 'after')
    expect(listHistory('u1', 'after')).toEqual([])
  })

  test('records WHO sent it — the ring is shared between agent and user', () => {
    recordSend('u-src', 'r', res(200), 'agent')
    recordSend('u-src', 'r', res(200), 'user')
    // Newest first: the user's send leads, the agent's follows.
    expect(listHistory('u-src', 'r').map((e) => e.source)).toEqual(['user', 'agent'])
  })

  test('snapshots the request REDACTED — a literal credential never enters the ring', () => {
    const spec: RequestSpec = {
      url: 'https://api.dev/x',
      method: 'GET',
      headers: [],
      query: [],
      auth: { type: 'bearer', token: 'sk-literal-secret' },
    }
    recordSend('u-snap', 'r', res(200), 'agent', spec)
    const entry = listHistory('u-snap', 'r')[0]
    expect(entry.request?.auth).toEqual({ type: 'bearer', token: '••••••' })
    expect(JSON.stringify(entry.request)).not.toContain('sk-literal-secret')
  })

  test('a ${secret:KEY} reference stays legible in the snapshot — it is a pointer', () => {
    const spec: RequestSpec = {
      url: 'https://api.dev/x',
      method: 'GET',
      headers: [],
      query: [],
      auth: { type: 'bearer', token: '${secret:GH}' },
    }
    recordSend('u-ref', 'r', res(200), 'user', spec)
    expect(listHistory('u-ref', 'r')[0].request?.auth).toEqual({
      type: 'bearer',
      token: '${secret:GH}',
    })
  })
})

describe('global bounds', () => {
  // Per-request rings alone bounded nothing: every session that sent a request kept its ring for
  // the life of the process.
  test('the stalest key is dropped once there are too many, the fresh ones stay', () => {
    resetHistory()
    const { maxKeys } = HISTORY_LIMITS
    for (let i = 0; i <= maxKeys; i++)
      recordSend('u-lru', 'r', res(200), 'user', undefined, `s${i}`)
    expect(listHistory('u-lru', 'r', 's0')).toEqual([])
    expect(listHistory('u-lru', 'r', 's1')).toHaveLength(1)
    expect(listHistory('u-lru', 'r', `s${maxKeys}`)).toHaveLength(1)
  })

  test('sending again refreshes a key, so the untouched one is evicted instead', () => {
    resetHistory()
    const { maxKeys } = HISTORY_LIMITS
    for (let i = 0; i < maxKeys; i++) recordSend('u-lru', 'r', res(200), 'user', undefined, `s${i}`)
    recordSend('u-lru', 'r', res(201), 'user', undefined, 's0')
    recordSend('u-lru', 'r', res(200), 'user', undefined, 'new')
    expect(listHistory('u-lru', 'r', 's0')).toHaveLength(2)
    expect(listHistory('u-lru', 'r', 's1')).toEqual([])
  })

  test('total body size is bounded: old bodies of other keys go before the new send', () => {
    resetHistory()
    const big = (n: number): SendResponse => ({ ...res(200), body: 'x'.repeat(n) })
    const quarter = Math.floor(HISTORY_LIMITS.maxBodyChars / 4)
    for (let i = 0; i < 4; i++) recordSend('u-bytes', `r${i}`, big(quarter), 'user')
    recordSend('u-bytes', 'latest', big(quarter), 'user')
    expect(listHistory('u-bytes', 'r0')).toEqual([])
    expect(listHistory('u-bytes', 'latest')).toHaveLength(1)
    const total = ['r1', 'r2', 'r3', 'latest']
      .flatMap((name) => listHistory('u-bytes', name))
      .reduce((sum, entry) => sum + entry.response.body.length, 0)
    expect(total).toBeLessThanOrEqual(HISTORY_LIMITS.maxBodyChars)
  })
})
