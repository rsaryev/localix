import { describe, expect, test } from 'bun:test'
import { createMistakeTracker } from './mistake-tracker'

describe('createMistakeTracker', () => {
  test('MIXED reasons accumulate into one consecutive counter and stop at the default 5', () => {
    const tracker = createMistakeTracker()
    tracker.record('api_error', 'provider 529: overloaded')
    tracker.record('invalid_tool_call', 'edit: missing path')
    tracker.record('tool_execution_failed', 'bash: exit 127')
    tracker.record('api_error', 'provider 500')
    expect(tracker.check()).toEqual({ action: 'ok' }) // 4 < 5 — more generous than the failure guard
    tracker.record('invalid_tool_call', 'edit: old_string not found')

    const verdict = tracker.check()
    expect(verdict.action).toBe('stop')
    if (verdict.action !== 'stop') return
    // The breakdown names every reason with its share, plus the last detail and the resume line.
    expect(verdict.message).toContain('5 consecutive failures')
    expect(verdict.message).toContain('2 api errors')
    expect(verdict.message).toContain('2 invalid tool calls')
    expect(verdict.message).toContain('1 execution failure')
    expect(verdict.message).toContain('last: edit: old_string not found')
    expect(verdict.message).toContain('Session state was preserved. Send a new prompt to resume.')
  })

  test('a success resets everything — 4 failures, success, 4 more failures never trip', () => {
    const tracker = createMistakeTracker()
    for (let i = 0; i < 4; i++) tracker.record('tool_execution_failed')
    tracker.recordSuccess()
    expect(tracker.state()).toEqual({
      consecutive: 0,
      perReason: { api_error: 0, invalid_tool_call: 0, tool_execution_failed: 0 },
    })
    for (let i = 0; i < 4; i++) tracker.record('api_error')
    expect(tracker.check()).toEqual({ action: 'ok' })
  })

  test('onLimit continue-with-notice injects guidance ONCE and resets the budget', () => {
    let consulted = 0
    const tracker = createMistakeTracker({
      maxConsecutive: 3,
      onLimit: () => {
        consulted += 1
        return 'continue-with-notice'
      },
    })
    tracker.record('api_error', 'provider 502')
    tracker.record('tool_execution_failed', 'bash: exit 1')
    tracker.record('invalid_tool_call', 'write: path required')

    const verdict = tracker.check()
    expect(verdict.action).toBe('notice')
    if (verdict.action !== 'notice') return
    expect(verdict.text).toContain('3 consecutive failures')
    expect(verdict.text).toContain('1 api error') // singular label form
    // Reset after the notice: a fresh budget, not an immediate re-trip on the next failure.
    expect(tracker.check()).toEqual({ action: 'ok' })
    tracker.record('api_error')
    expect(tracker.check()).toEqual({ action: 'ok' })
    expect(consulted).toBe(1)
  })

  test('the stop verdict LATCHES: same message on re-check, onLimit consulted once, success cannot un-stop', () => {
    let consulted = 0
    const tracker = createMistakeTracker({
      maxConsecutive: 2,
      onLimit: () => {
        consulted += 1
        return 'stop'
      },
    })
    tracker.record('tool_execution_failed', 'bash: exit 2')
    tracker.record('tool_execution_failed', 'read: no such file')
    const first = tracker.check()
    expect(first.action).toBe('stop')
    tracker.recordSuccess() // racing success after the episode resolved
    const second = tracker.check()
    expect(second).toEqual(first)
    expect(consulted).toBe(1)
  })

  test('per-reason state and last detail are inspectable', () => {
    const tracker = createMistakeTracker()
    tracker.record('api_error', 'provider 429')
    tracker.record('api_error') // no detail — the previous one is kept for the message
    expect(tracker.state()).toEqual({
      consecutive: 2,
      perReason: { api_error: 2, invalid_tool_call: 0, tool_execution_failed: 0 },
      lastReason: 'api_error',
      lastDetail: 'provider 429',
    })
  })

  test('maxConsecutive has a floor of 2 so a first failure can never stop a run', () => {
    const tracker = createMistakeTracker({ maxConsecutive: 1 })
    tracker.record('tool_execution_failed')
    expect(tracker.check()).toEqual({ action: 'ok' })
    tracker.record('tool_execution_failed')
    expect(tracker.check().action).toBe('stop')
  })
})
