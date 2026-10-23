import { describe, expect, test } from 'bun:test'

import { analyzeBoot } from './startup-budget'

const line = (entry: Record<string, unknown>) => JSON.stringify(entry)
const request = (time: number, path: string, extra: Record<string, unknown> = {}) =>
  line({ event: 'request.completed', time, method: 'GET', path, durationMs: 1, ...extra })

describe('startup budget analysis', () => {
  test('measures the LAST boot, not the first one in an append-only log', () => {
    const analysis = analyzeBoot([
      line({ event: 'server.started', time: 1_000 }),
      request(1_100, '/rpc/old-boot'),
      line({ event: 'server.started', time: 10_000 }),
      request(10_100, '/rpc/sessions'),
    ])
    expect(analysis?.startedAt).toBe(10_000)
    expect(analysis?.requests.map((r) => r.path)).toEqual(['/rpc/sessions'])
  })

  test('the window ends, so steady-state traffic is not billed to startup', () => {
    const analysis = analyzeBoot(
      [
        line({ event: 'server.started', time: 0 }),
        request(100, '/rpc/sessions'),
        request(9_000, '/rpc/much-later'),
      ],
      5_000,
    )
    expect(analysis?.requests.map((r) => r.path)).toEqual(['/rpc/sessions'])
  })

  test('the same answer fetched under different query keys still counts as a repeat', () => {
    // This is the shape that hid a repeat: /rpc/tools/gc seven times, split across
    // `?sessionId` and `?projectId,sessionId`. Keying on the query would have hidden it.
    const analysis = analyzeBoot([
      line({ event: 'server.started', time: 0 }),
      request(10, '/rpc/tools/gc', { queryKeys: 'sessionId', durationMs: 900 }),
      request(20, '/rpc/tools/gc', { queryKeys: 'projectId,sessionId', durationMs: 1_100 }),
      request(30, '/rpc/sessions'),
    ])
    expect(analysis?.repeated).toEqual([{ key: '/rpc/tools/gc', count: 2, totalMs: 2_000 }])
  })

  test('a launch that writes is reported as writing', () => {
    const analysis = analyzeBoot([
      line({ event: 'server.started', time: 0 }),
      request(10, '/rpc/sessions/LOCALIX-1', { method: 'PATCH' }),
      request(20, '/rpc/sessions'),
    ])
    expect(analysis?.writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      'PATCH /rpc/sessions/LOCALIX-1',
    ])
  })

  test('a torn final line does not lose the boot', () => {
    // The log is written by a process that can be killed mid-flush; refusing to parse
    // the file over one broken line would make this useless exactly when it matters.
    const analysis = analyzeBoot([
      line({ event: 'server.started', time: 0 }),
      request(10, '/rpc/sessions'),
      '{"event":"request.comple',
    ])
    expect(analysis?.requests).toHaveLength(1)
  })

  test('no boot in the log is an answer, not a crash', () => {
    expect(analyzeBoot(['', request(10, '/rpc/sessions')])).toBeNull()
  })

  /**
   * Loading mini app backends happens off the request path, so the most expensive thing a launch
   * does was invisible to a report about launches. The loader now says what it cost.
   */
  test('collects mini app loads, so a boot that loads them twice says so', () => {
    const load = (time: number, totalMs: number) =>
      line({
        event: 'mini_apps.loaded',
        time,
        apps: 9,
        importMs: totalMs - 4,
        totalMs,
        slowest: [{ name: 'database', ms: 53 }],
      })
    const analysis = analyzeBoot([
      line({ event: 'server.started', time: 0 }),
      load(100, 170),
      load(300, 120),
      // Outside the window: steady-state work is not billed to startup.
      load(9_000, 90),
    ])

    expect(analysis?.miniAppLoads.map((entry) => entry.totalMs)).toEqual([170, 120])
    expect(analysis?.miniAppLoads[0].slowest[0]).toEqual({ name: 'database', ms: 53 })
  })
})
