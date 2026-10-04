import { describe, expect, test } from 'bun:test'
import { createNextEditTelemetry } from './predict-next-edit-telemetry'

const event = {
  userId: 'u',
  sessionId: 's',
  outcome: 'empty' as const,
  durationMs: 4,
  contextReferenceCount: 0,
  editCount: 0,
}

describe('createNextEditTelemetry', () => {
  test('is a no-op while the baseline flag is off', () => {
    const original = console.info
    let calls = 0
    console.info = () => {
      calls++
    }
    try {
      createNextEditTelemetry(false)(event)
    } finally {
      console.info = original
    }
    expect(calls).toBe(0)
  })

  test('emits metadata only while enabled', () => {
    const original = console.info
    const calls: unknown[][] = []
    console.info = (...args) => {
      calls.push(args)
    }
    try {
      createNextEditTelemetry(true)(event)
    } finally {
      console.info = original
    }
    expect(calls).toEqual([['[edit-prediction]', JSON.stringify({ event: 'outcome', ...event })]])
  })
})
