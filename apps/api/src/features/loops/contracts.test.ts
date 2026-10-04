import { describe, expect, test } from 'bun:test'

import {
  DYNAMIC_MAX_DELAY_SECONDS,
  DYNAMIC_MIN_DELAY_SECONDS,
  LOOP_MAINTENANCE_PROMPT,
  toLoopSummary,
  type SessionLoop,
} from './contracts'

// A COMPLETE loop — a fire has already happened, so the run-stat fields carry real
// values. They used to be omitted here; because `toEqual` treats an `undefined`
// property as absent, `target`/`lastRunAt`/`lastStatus`/`runCount` then projected to
// `undefined` and the "projects exactly" assertion below pinned NONE of them —
// deleting all four from `toLoopSummary` left this file green.
const fixed: SessionLoop = {
  id: 'loop-1',
  userId: 'u',
  sessionId: 's',
  kind: 'fixed',
  cron: '*/5 * * * *',
  prompt: 'check deploy',
  maintenance: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  nextRunAt: '2026-06-16T10:05:00.000Z',
  target: 'session',
  lastRunAt: '2026-06-16T10:00:00.000Z',
  lastStatus: 'ok',
  lastError: null,
  runCount: 3,
}

describe('toLoopSummary', () => {
  test('projects exactly the public fields of a fixed loop (drops userId/sessionId)', () => {
    const summary = toLoopSummary(fixed)
    // toStrictEqual, not toEqual: a projected key whose value is `undefined` must be
    // declared here too, so a field silently dropped from the projection goes red.
    expect(summary).toStrictEqual({
      id: 'loop-1',
      kind: 'fixed',
      cron: '*/5 * * * *',
      prompt: 'check deploy',
      maintenance: false,
      delaySeconds: undefined,
      nextRunAt: '2026-06-16T10:05:00.000Z',
      createdAt: '2026-06-16T10:00:00.000Z',
      target: 'session',
      lastRunAt: '2026-06-16T10:00:00.000Z',
      lastStatus: 'ok',
      runCount: 3,
    })
    expect('userId' in summary).toBe(false)
    expect('sessionId' in summary).toBe(false)
    // lastError is internal — deliberately NOT part of the public summary.
    expect('lastError' in summary).toBe(false)
  })

  test("carries a dynamic loop's delaySeconds and null cron through", () => {
    const summary = toLoopSummary({
      ...fixed,
      kind: 'dynamic',
      cron: null,
      delaySeconds: 180,
    })
    expect(summary.kind).toBe('dynamic')
    expect(summary.cron).toBeNull()
    expect(summary.delaySeconds).toBe(180)
  })
})

describe('loop constants', () => {
  test('the dynamic delay window is sane (floor < ceiling, mirrors the harness)', () => {
    expect(DYNAMIC_MIN_DELAY_SECONDS).toBe(60)
    expect(DYNAMIC_MAX_DELAY_SECONDS).toBe(3600)
    expect(DYNAMIC_MIN_DELAY_SECONDS).toBeLessThan(DYNAMIC_MAX_DELAY_SECONDS)
  })

  test('the maintenance prompt is self-contained and scope-guarded', () => {
    expect(LOOP_MAINTENANCE_PROMPT).toContain('maintenance loop iteration')
    expect(LOOP_MAINTENANCE_PROMPT).toContain('Do not start new initiatives')
  })
})
