import { describe, expect, test } from 'bun:test'

import type { MonitorCondition, MonitorEmit } from './contracts'
import { FIRST_POLL, pollStateOf, pollStep, type PollState, type PollStep } from './poll-step'

/**
 * One poll of an `until` wait is the half that replaces a hand-written poll loop, so what is
 * worth testing is exactly what those loops got wrong: firing more than once, never reporting a
 * change, and watching forever when the check itself cannot run. The step is pure, so a sequence
 * of samples IS the wait — no timers, no process.
 */
function run(
  samples: { stdout?: string; stderr?: string; exitCode?: number }[],
  when: MonitorCondition,
  emit: MonitorEmit,
): PollStep[] {
  let state: PollState = FIRST_POLL
  const steps: PollStep[] = []
  for (const sample of samples) {
    const step = pollStep({
      sample: {
        stdout: sample.stdout ?? '',
        stderr: sample.stderr ?? '',
        exitCode: sample.exitCode ?? 0,
      },
      state,
      when,
      emit,
      check: 'status.sh',
    })
    steps.push(step)
    state = step.state
    if (step.end) break
  }
  return steps
}

describe('pollStep', () => {
  test('a condition that already holds ends the wait on the first poll, with its evidence', () => {
    const [step] = run([{ stdout: 'success' }], { kind: 'regex', value: 'success|failed' }, 'once')
    expect(step!.end?.reason).toBe('condition-met')
    expect(step!.events).toHaveLength(1)
    expect(step!.events[0]).toContain('success')
  })

  test('emit "once" reports exactly once, after N quiet polls', () => {
    const steps = run(
      [{ stdout: 'running' }, { stdout: 'running' }, { stdout: 'failed' }],
      { kind: 'regex', value: 'success|failed' },
      'once',
    )
    expect(steps.map((step) => step.events.length)).toEqual([0, 0, 1])
    expect(steps.at(-1)!.events[0]).toContain('failed')
    expect(steps.at(-1)!.end?.reason).toBe('condition-met')
  })

  test('emit "on_change" reports transitions on the way to the ending', () => {
    // The pipeline case: each step lands as an event, and the terminal status also ends it —
    // this is the `prev=""` diff every hand-written loop had to get right.
    const steps = run(
      [{ stdout: 'build: running' }, { stdout: 'build: success' }, { stdout: 'test: failed' }],
      { kind: 'regex', value: 'failed|canceled' },
      'on_change',
    )
    const events = steps.flatMap((step) => step.events)
    // First poll has no previous value to differ from, so it is not a "change".
    expect(events[0]).toContain('build: success')
    expect(events.at(-1)).toContain('test: failed')
    // The change already said it; the ending does not add the same line again.
    expect(events).toHaveLength(2)
  })

  test('emit "every" keeps reporting and does NOT end the wait', () => {
    const steps = run(
      [{ stdout: '42' }, { stdout: '42' }],
      { kind: 'number', bound: { gte: 10 } },
      'every',
    )
    expect(steps.map((step) => step.events.length)).toEqual([1, 1])
    expect(steps.every((step) => step.end === undefined)).toBe(true)
  })

  test('a check that cannot EXECUTE ends the wait on the first poll', () => {
    // 127 = command not found. Waiting five intervals to say so would hide a typo behind a
    // monitor that looks healthy — the most expensive failure this feature has.
    const [step] = run(
      [{ exitCode: 127, stderr: 'gh: command not found' }],
      { kind: 'exit_zero' },
      'once',
    )
    expect(step!.end).toEqual({
      reason: 'error',
      detail: 'check exited 127 (cannot execute): gh: command not found',
    })
  })

  test('a check that stops executing LATER is tolerated four times, then ends the wait', () => {
    const steps = run(
      [{ exitCode: 1 }, ...Array.from({ length: 5 }, () => ({ exitCode: 127 }))],
      { kind: 'exit_zero' },
      'once',
    )
    expect(steps).toHaveLength(6)
    expect(steps.at(-1)!.end?.reason).toBe('error')
  })

  test('the state it carries survives a restart as data', () => {
    const [first] = run([{ stdout: 'running' }], { kind: 'contains', value: 'done' }, 'on_change')
    // What the trigger payload stores and reads back; an unchanged value is not a change.
    const restored = pollStateOf(JSON.parse(JSON.stringify({ poll: first!.state })))
    const next = pollStep({
      sample: { stdout: 'running', stderr: '', exitCode: 0 },
      state: restored,
      when: { kind: 'contains', value: 'done' },
      emit: 'on_change',
      check: 'status.sh',
    })
    expect(next.events).toEqual([])
    expect(pollStateOf({})).toEqual(FIRST_POLL)
  })
})
