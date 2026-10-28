import { describe, expect, test } from 'bun:test'

import type { SessionLoop } from './contracts'
import { buildLoopWake } from './wake'

const loop = (patch: Partial<SessionLoop>): SessionLoop => ({
  id: 'loop-1',
  userId: 'u',
  sessionId: 's',
  kind: 'fixed',
  cron: '*/5 * * * *',
  prompt: 'Check the deploy.',
  maintenance: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  nextRunAt: '2026-09-01T00:05:00.000Z',
  target: 'session',
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  runCount: 0,
  ...patch,
})

describe('buildLoopWake — which tools a fire may not call', () => {
  // A disabled tool changes the roster, which rewrites the cached prefix on every fire, and the
  // drain unions a coalesced band's disabled tools, so a message sent beside the fire lost
  // `loops` too. The fixed schedule is protected at execution instead (`reschedule` refuses it).
  test('a fixed fire in its own session keeps the run tool roster', () => {
    expect(buildLoopWake(loop({}))).toEqual({
      content: 'Check the deploy.',
      extraDisabledTools: [],
    })
  })

  test('a dynamic fire keeps `loops`, because pacing is the agent’s job', () => {
    const wake = buildLoopWake(loop({ kind: 'dynamic', cron: null }))
    expect(wake.extraDisabledTools).toEqual([])
    expect(wake.content).toContain('action="reschedule"')
  })

  test('a subsession round manages no loops: it is a fresh child with its own roster', () => {
    expect(buildLoopWake(loop({ target: 'subsession' })).extraDisabledTools).toEqual(['Loops'])
  })
})
