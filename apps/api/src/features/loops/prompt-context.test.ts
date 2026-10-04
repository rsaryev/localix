import { describe, expect, test } from 'bun:test'

import type { SessionLoop } from './contracts'
import { toLoopPromptContext } from './prompt-context'

/** A never-yet-fired loop: run stats at their pre-first-fire values. */
const base: Omit<SessionLoop, 'id' | 'kind' | 'cron'> = {
  userId: 'u',
  sessionId: 's',
  prompt: 'ping',
  maintenance: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  nextRunAt: '2026-06-16T11:00:00.000Z',
  target: 'session',
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  runCount: 0,
}

function fixed(over: Partial<SessionLoop> = {}): SessionLoop {
  return { ...base, id: '1', kind: 'fixed', cron: '*/5 * * * *', ...over }
}
function dynamic(over: Partial<SessionLoop> = {}): SessionLoop {
  return { ...base, id: '2', kind: 'dynamic', cron: null, ...over }
}

describe('toLoopPromptContext', () => {
  test('returns undefined when there are no loops', () => {
    expect(toLoopPromptContext([])).toBeUndefined()
  })

  test('maps a fixed loop with its cron as the cadence', () => {
    const ctx = toLoopPromptContext([fixed()])
    expect(ctx?.loops).toEqual([{ id: '1', kind: 'fixed', cadence: '*/5 * * * *', prompt: 'ping' }])
  })

  test('falls back to "fixed" when a fixed loop has no cron', () => {
    expect(toLoopPromptContext([fixed({ cron: null })])?.loops[0]!.cadence).toBe('fixed')
  })

  test('renders a dynamic cadence rounded to minutes when delaySeconds is set', () => {
    expect(toLoopPromptContext([dynamic({ delaySeconds: 150 })])?.loops[0]!.cadence).toBe(
      'dynamic ~3m',
    )
  })

  test('renders a bare "dynamic" cadence when delaySeconds is absent or zero', () => {
    expect(toLoopPromptContext([dynamic()])?.loops[0]!.cadence).toBe('dynamic')
    expect(toLoopPromptContext([dynamic({ delaySeconds: 0 })])?.loops[0]!.cadence).toBe('dynamic')
  })

  test('truncates a long prompt to 80 chars with an ellipsis, leaves short ones intact', () => {
    const long = 'x'.repeat(120)
    const truncated = toLoopPromptContext([fixed({ prompt: long })])?.loops[0]!.prompt
    expect(truncated).toBe(`${'x'.repeat(80)}…`)
    expect(truncated!.length).toBe(81)
    expect(toLoopPromptContext([fixed({ prompt: 'short' })])?.loops[0]!.prompt).toBe('short')
  })

  test('maps every loop in the list, preserving order', () => {
    const ctx = toLoopPromptContext([fixed(), dynamic({ delaySeconds: 600 })])
    expect(ctx?.loops.map((l) => l.id)).toEqual(['1', '2'])
    expect(ctx?.loops.map((l) => l.kind)).toEqual(['fixed', 'dynamic'])
  })
})
