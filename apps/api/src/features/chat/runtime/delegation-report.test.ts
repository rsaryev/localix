import { describe, expect, test } from 'bun:test'
import {
  childReport,
  delegationReportKey,
  delegationReportMessage,
  delegationReportRecipient,
  delegationReportSession,
  delegationReportWake,
} from './delegation-report'

/**
 * The bound on what a finished child injects into its parent's conversation.
 *
 * This is the defence against the failure mode that made one session unrecoverable
 * rather than merely expensive: children returned their full final texts verbatim into
 * the root until its next request estimated 285154 tokens against a 230400 budget, after
 * which EVERY run in that conversation failed with `LocalContextBudgetExceededError`. The
 * lane and tree caps bound how many children exist; this bounds what each one costs the
 * parent, which is a different failure with a different fix.
 */
describe('child report bounding', () => {
  test('a short report passes through byte-for-byte', () => {
    const text = 'Found the bug in src/a.ts:42 — an off-by-one in the retry loop.'
    expect(childReport(text, 'LOCALIX-9')).toBe(text)
  })

  test('a long report is capped and names the child session to read', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const out = childReport(text, 'LOCALIX-9')

    expect(out.length).toBeLessThan(text.length)
    // Actionable, not just truncated: the transcript is still reachable, and the parent
    // needs the session id to reach it. Without this the cap would DESTROY information
    // instead of relocating it.
    expect(out).toContain('global_search')
    expect(out).toContain('LOCALIX-9')
  })

  test('keeps the END of a long report — that is where a conclusion is', () => {
    const text = [...Array.from({ length: 400 }, (_, i) => `filler ${i}`), 'VERDICT: ship it'].join(
      '\n',
    )
    const out = childReport(text, 'LOCALIX-9')
    expect(out).toContain('VERDICT: ship it')
    expect(out).not.toContain('filler 0\n')
  })

  test('a single enormous line is still bounded', () => {
    // Byte and line limits are independent: a report with no newlines at all would slip
    // through a line-only cap entirely.
    const out = childReport('x'.repeat(200_000), 'LOCALIX-9')
    expect(out.length).toBeLessThan(60_000)
  })

  test('empty and whitespace input do not fabricate a marker', () => {
    expect(childReport('', 'LOCALIX-9')).toBe('')
    expect(childReport('   ', 'LOCALIX-9')).toBe('   ')
  })
})

describe('child report routing', () => {
  test('returns the detached result to the participant who delegated it', () => {
    expect(delegationReportRecipient('builtin:localix', 'localix')).toEqual({
      participant: 'agent:builtin:localix',
      handle: 'localix',
    })
    expect(delegationReportRecipient(undefined, 'localix')).toBeUndefined()
  })

  test('a report wakes the session that DELEGATED — a grandchild answers its child, not the root', () => {
    // Sending it to the root skipped the agent that asked for the work.
    expect(delegationReportSession({ id: 'mid' })).toBe('mid')
    expect(delegationReportSession({ id: 'root' })).toBe('root')
  })
})

describe('child report wording', () => {
  test('an empty report says there was no final text and where the transcript is', () => {
    const message = delegationReportMessage({
      label: 'Audit',
      childSessionId: 'c1',
      runId: 'm1',
      status: 'completed',
      text: '  ',
    })
    expect(message).toContain('no final text')
    expect(message).toContain('global_search')
  })

  test('the status and the child are named in the headline', () => {
    const message = delegationReportMessage({
      label: 'Audit',
      childSessionId: 'c1',
      runId: 'm1',
      status: 'stopped',
      text: 'partial',
    })
    expect(message.split('\n')[0]).toBe(
      '[Delegated task was STOPPED before finishing] Audit (id: c1) was STOPPED before finishing.',
    )
  })

  test('a follow-up goes to the same child, not to a fresh one', () => {
    // A new child knows nothing the first learned; a message keeps all of it.
    const message = delegationReportMessage({
      label: 'Audit',
      childSessionId: 'c1',
      runId: 'm1',
      status: 'completed',
      text: 'done',
    })
    expect(message.startsWith('[Delegated task finished]')).toBe(true)
    expect(message).toContain('Its final report:\ndone')
    expect(message).toContain('`delegate` action:"message"')
  })
})

describe('one report per run', () => {
  test('each run of a child is its own delivery, so a second report is not a duplicate', () => {
    // Keyed per CHILD, the receipt admitted the first report and refused every later run's as a
    // duplicate — the parent heard about the delegated task and never about a follow-up.
    const wake = (runId: string) =>
      delegationReportWake({
        userId: 'u',
        parent: { id: 'root' },
        delegatingAgentId: null,
        handle: null,
        label: 'Audit',
        childSessionId: 'c1',
        runId,
        status: 'completed',
        text: 'done',
      })
    expect(wake('m1').deliveryKey).toBe(delegationReportKey('c1', 'm1'))
    expect(wake('m2').deliveryKey).not.toBe(wake('m1').deliveryKey)
    expect(wake('m1')).toMatchObject({ receipt: true, source: 'subagent', sessionId: 'root' })
  })
})
