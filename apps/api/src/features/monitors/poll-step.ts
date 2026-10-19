/**
 * `until` mode, one poll at a time: given what the check printed and what the earlier polls saw,
 * what is there to report, and is the wait over?
 *
 * This is the half that replaces the loop the agent used to hand-write for every wait —
 * `prev=""; while …; do curl … | python3 -c '…'; sleep 30; done` — where the recurring bugs
 * were always the same: no previous-state diff (so every tick re-reported), no coverage of
 * terminal failure states (so a crashed pipeline looked like a running one), and a check that
 * could not run at all silently looping forever. So one step owns those three:
 *
 *   - `emit: 'once' | 'on_change' | 'every'` is the diff policy, not the script's business;
 *   - the predicate's own `detail` becomes the event text, so a wake carries EVIDENCE
 *     ("status=failed", "36.2 ≥ 35") rather than "condition met";
 *   - a check that cannot execute (127/126) ends the wait with `error` instead of watching
 *     nothing — the first poll is enough to know a command name is wrong.
 *
 * Pure, and the state it carries is plain data: the cadence is the trigger's (`triggers/kinds/
 * poll`), and the state rides the trigger's payload — so a wait resumed after a restart still
 * knows what it last saw and does not report an unchanged value as a change. What it last saw is
 * kept as a DIGEST, never the text: a check's output can echo a credential, and the payload is a
 * row in the database.
 */
import { createHash } from 'node:crypto'

import { evaluateCondition, sampleText, type MonitorSample } from './conditions'
import type { MonitorCondition, MonitorEmit, MonitorEndReason } from './contracts'

/** Consecutive "cannot execute" polls tolerated before the wait gives up. */
const MAX_CHECK_FAILURES = 5
/** A check gets at most this long, and never longer than its own interval. */
const CHECK_TIMEOUT_FLOOR_MS = 5_000
const CHECK_TIMEOUT_CEILING_MS = 30_000
/** Output lines of the poll that met the condition carried into the wake. */
const FINAL_OUTPUT_LINES = 12

export interface PollState {
  polls: number
  failures: number
  /** Digest of the previous poll's output — enough to tell a change, and nothing to leak. */
  lastDigest: string | null
}

export const FIRST_POLL: PollState = { polls: 0, failures: 0, lastDigest: null }

const digest = (text: string) => createHash('sha256').update(text).digest('base64url')

export interface PollStep {
  /** Event texts worth a wake from this poll. */
  events: string[]
  /** Set when this poll ended the wait. */
  end?: { reason: Extract<MonitorEndReason, 'condition-met' | 'error'>; detail: string }
  state: PollState
}

export function checkTimeoutMs(everySeconds: number): number {
  return Math.max(CHECK_TIMEOUT_FLOOR_MS, Math.min(everySeconds * 1000, CHECK_TIMEOUT_CEILING_MS))
}

/** Exit codes that mean the check itself is unrunnable, not that its answer was "no". */
const isUnrunnable = (exitCode: number): boolean =>
  exitCode === 126 || exitCode === 127 || exitCode === -1

function firstLine(text: string): string {
  const [line = ''] = text.split('\n')
  return line.length > 300 ? `${line.slice(0, 300)}…` : line
}

/** The tail of the deciding poll's output: where a check prints its summary. */
function finalLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .slice(-FINAL_OUTPUT_LINES)
    .map(firstLine)
}

export function pollStep(input: {
  sample: MonitorSample
  state: PollState
  when: MonitorCondition
  emit: MonitorEmit
  /** The check as written, for an error that has nothing better to show. */
  check: string
}): PollStep {
  const { sample, when, emit } = input
  const polls = input.state.polls + 1
  const unrunnable = isUnrunnable(sample.exitCode)
  const failures = unrunnable ? input.state.failures + 1 : 0
  const text = sampleText(sample)
  const state: PollState = { polls, failures, lastDigest: digest(text) }
  // The first poll is enough to know a command NAME is wrong; waiting five intervals to say so
  // would just hide the typo behind a wait that appears to be working.
  if (unrunnable && (polls === 1 || failures >= MAX_CHECK_FAILURES)) {
    const detail = `check exited ${sample.exitCode} (cannot execute): ${firstLine(text) || input.check}`
    return { events: [], end: { reason: 'error', detail }, state }
  }

  const events: string[] = []
  const changed = input.state.lastDigest !== null && state.lastDigest !== input.state.lastDigest
  const reportedChange = emit === 'on_change' && changed && Boolean(text)
  if (reportedChange) events.push(firstLine(text))
  const verdict = evaluateCondition(sample, when)
  if (!verdict.satisfied) return { events, state }
  if (emit === 'every') return { events: [...events, verdict.detail], state }
  // One poll, one event. When the change was already reported, the raw line IS the news
  // ("test: failed"); adding the predicate's own phrasing would say the same thing twice, and
  // the ending carries that phrasing anyway.
  // The ending names the predicate; what the check printed is the news. A wake without it sent
  // the agent to run the same check once more just to read the result it was woken for.
  if (!reportedChange) events.push(...(text ? finalLines(text) : [verdict.detail]))
  return { events, end: { reason: 'condition-met', detail: verdict.detail }, state }
}

/** The state a payload carries, read defensively: a row is data from an older process. */
export function pollStateOf(payload: Record<string, unknown>): PollState {
  const raw = payload.poll as Partial<PollState> | undefined
  return {
    polls: typeof raw?.polls === 'number' ? raw.polls : 0,
    failures: typeof raw?.failures === 'number' ? raw.failures : 0,
    lastDigest: typeof raw?.lastDigest === 'string' ? raw.lastDigest : null,
  }
}
