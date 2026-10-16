/**
 * The mid-run reminder queue: what the host hands to the loop's tool-result seam.
 *
 * The contract that matters is DRAIN-ONCE. The loop appends whatever `drain` returns
 * exactly once and never re-reads it, so a peek would re-send the same reminder on
 * every tool call of the turn, and a drain that forgets to clear on the empty path
 * would resurrect an old one.
 */
import { describe, expect, test } from 'bun:test'
import {
  backgroundJobFinishedReminder,
  backgroundJobOutcome,
  drainMidRunReminders,
  forgetMidRunReminders,
  MID_RUN_REMINDER_MAX,
  recordMidRunReminder,
  type MidRunReminderState,
} from './mid-run-reminders'

const newState = (): MidRunReminderState => ({ midRunReminders: new Map() })
const A = { sessionId: 's1', agentId: 'lead' }
const COLLEAGUE = { sessionId: 's1', agentId: 'qa' }
const ELSEWHERE = { sessionId: 's2', agentId: 'lead' }

describe('recordMidRunReminder / drainMidRunReminders', () => {
  test('a drained reminder never comes back', () => {
    const state = newState()
    recordMidRunReminder(state, A, 'job finished')

    const first = drainMidRunReminders(state, A)
    expect(first).toContain('job finished')
    // The loop already appended it — a second drain must be silence, not a repeat.
    expect(drainMidRunReminders(state, A)).toBeNull()
  })

  test('nothing pending is null, so the loop appends no empty user turn', () => {
    expect(drainMidRunReminders(newState(), ELSEWHERE)).toBeNull()
  })

  test('a batch arrives as ONE envelope, not one interruption per fact', () => {
    const state = newState()
    recordMidRunReminder(state, A, 'job A finished')
    recordMidRunReminder(state, A, 'job B finished')

    const body = drainMidRunReminders(state, A)
    expect(body).toContain('job A finished')
    expect(body).toContain('job B finished')
    expect(body?.match(/<system-reminder>/g)).toHaveLength(1)
    // Tags are added here, once, so a caller can never emit a half-formed envelope.
    expect(body?.startsWith('<system-reminder>')).toBe(true)
    expect(body?.endsWith('</system-reminder>')).toBe(true)
  })

  test('one session never reads another session queue', () => {
    const state = newState()
    recordMidRunReminder(state, A, 'mine')
    expect(drainMidRunReminders(state, ELSEWHERE)).toBeNull()
    expect(drainMidRunReminders(state, A)).toContain('mine')
  })

  test("a colleague's run never reads the note about a job someone else started", () => {
    // Keyed by session alone, @lead's finished job was announced inside @qa's run.
    const state = newState()
    recordMidRunReminder(state, A, 'your build finished')
    expect(drainMidRunReminders(state, COLLEAGUE)).toBeNull()
    expect(drainMidRunReminders(state, A)).toContain('your build finished')
  })

  test('a blank body is dropped rather than queued as an empty line', () => {
    const state = newState()
    recordMidRunReminder(state, A, '   ')
    expect(drainMidRunReminders(state, A)).toBeNull()
  })

  test('past the cap the NEWEST survive — a flood must not push out what still matters', () => {
    const state = newState()
    for (let i = 0; i < MID_RUN_REMINDER_MAX + 3; i++) recordMidRunReminder(state, A, `job ${i}`)

    const body = drainMidRunReminders(state, A) ?? ''
    expect(body).not.toContain('job 0')
    expect(body).toContain(`job ${MID_RUN_REMINDER_MAX + 2}`)
  })

  test('forget drops every participant queue when the session dies mid-turn', () => {
    const state = newState()
    recordMidRunReminder(state, A, 'job finished')
    recordMidRunReminder(state, COLLEAGUE, 'job finished')
    recordMidRunReminder(state, ELSEWHERE, 'unrelated')
    forgetMidRunReminders(state, 's1')
    expect(drainMidRunReminders(state, A)).toBeNull()
    expect(drainMidRunReminders(state, COLLEAGUE)).toBeNull()
    expect(drainMidRunReminders(state, ELSEWHERE)).toContain('unrelated')
  })
})

describe('backgroundJobFinishedReminder', () => {
  test('a stopped job reads as stopped, not failed — the caller asked for it', () => {
    const text = backgroundJobFinishedReminder('sleep 40', -1, 'tc-1', true, 'killed')
    expect(text).toContain('A background job you started was stopped while')
    expect(text).not.toContain('FAILED')
  })

  // LOCALIX-388: `python3 -m http.server` started with `timeout: 60` was closed at 60 s (exit
  // 130) and the agent was told it FAILED, so it went to restart a server nobody had broken.
  test('a job stopped by its timeout says so, never FAILED (exit 130)', () => {
    const text = backgroundJobFinishedReminder(
      'python3 -m http.server',
      130,
      'tc-1',
      true,
      'timeout',
      {
        by: 'timeout',
        timeoutSecs: 60,
      },
    )
    expect(text).toContain('was stopped after its 60 s timeout')
    expect(text).not.toContain('FAILED')
  })

  test('says who stopped a job, and a stop signal from elsewhere is a stop, not a failure', () => {
    expect(backgroundJobOutcome(130, 'killed', { by: 'person' })).toBe('was stopped by the person')
    expect(backgroundJobOutcome(143, 'killed', { by: 'agent' })).toBe(
      'was stopped as you requested',
    )
    expect(backgroundJobOutcome(130, 'killed')).toBe('was stopped by a signal (exit 130)')
    expect(backgroundJobOutcome(2, 'failed')).toBe('FAILED (exit 2)')
  })

  test('names the failure, so a non-zero exit is not read as success', () => {
    const failed = backgroundJobFinishedReminder('bun test', 1, 'call_1')
    expect(failed).toContain('FAILED (exit 1)')
    expect(backgroundJobFinishedReminder('bun test', 0, 'call_1')).toContain('successfully')
  })

  test('carries no output — an unbidden mid-turn note must stay one line', () => {
    // A build log can be megabytes and this lands in the middle of unrelated work.
    const body = backgroundJobFinishedReminder('bun run build', 0, 'call_1')
    expect(body.length).toBeLessThan(400)
  })

  test('points at the tool that can actually serve the withheld output', () => {
    // Withholding the output is only honest if the pointer resolves. `jobs
    // action="read"` cannot serve it: it reads the LIVE PTY scrollback through the
    // `backgroundJobs` entry, which the async registry's disposer deletes on exit —
    // so a read of the very job this reminder announces always misses, and says the
    // output "was returned when it finished", which on this branch it was not.
    // `tool_output` reads the durable item `emitBackground` persisted on done.
    const body = backgroundJobFinishedReminder('bun run build', 1, 'call_abc')
    expect(body).toContain('tool_output(action="get", tool_call_id="call_abc")')
    expect(body).not.toContain('action="read"')
  })

  test('does not advertise tool_output when the user disabled it', () => {
    const body = backgroundJobFinishedReminder('bun run build', 1, 'call_abc', false)
    expect(body).not.toContain('tool_output')
    expect(body).toContain('not stored in this run')
  })

  test('an unknown exit code says finished rather than inventing success', () => {
    const body = backgroundJobFinishedReminder('some job', undefined, 'call_1')
    expect(body).toContain('finished while you were working')
    expect(body).not.toContain('successfully')
  })
})
