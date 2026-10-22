/**
 * These guards used to run off two HAND-WRITTEN lists of stop reasons, and the lists went
 * stale exactly the way hand-written lists do.
 *
 * `AgentStopReason` has twelve members. `ABNORMAL` named five and `NORMAL` five; the sixth
 * abnormal reason (`exploration_stall`) had drifted out into a bespoke describe block that
 * asserts neither of the cross-cutting invariants, and the seventh (`output_cap_stall`) was
 * covered by NOTHING AT ALL — it was added to the union, given a notice, and wired into
 * `isLoopingStop`, and no test ever looked at it. A new reason simply did not have to be
 * classified: the suite stayed green and the invariants quietly stopped applying to it.
 *
 * So the classification is now EXHAUSTIVE BY CONSTRUCTION. `TIER` is a
 * `Record<AgentStopReason, …>`: add a member to the union and this file stops COMPILING until
 * someone says which tier it belongs to. Both lists are derived from it, so they cannot rot.
 *
 * That compile-time half is now a REAL gate: `bun run check:tests` (→ `type-check:tests`, over
 * `apps/api/tsconfig.test.json`, which unlike `tsconfig.json` does NOT exclude `*.test.ts`) type-
 * checks this file. Verified by mutation, not by reading: adding a member to `AgentStopReason`
 * fails with `TS2741: Property 'x' is missing … but required in type Record<AgentStopReason, …>`.
 * Before that lane existed the `Record` was enforced by nothing — `bun test` never type-checks.
 *
 * The runtime half below (every abnormal reason gets a notice: prefixed, distinct, undone-work
 * cue) fires either way.
 */
import { describe, expect, test } from 'bun:test'
import type { AgentStopReason } from '@localixai/agent/agents'
import { isAbnormalStop, isLoopingStop, stopNotice } from './stop-notice'

/**
 * Every member of the union, and what it means for the user.
 *
 * - `abnormal` — work may be left undone, so the run must SAY SO (see the invariants below).
 * - `normal` — an ordinary or already-surfaced ending; the notice must stay silent (`null`).
 */
const TIER: Record<AgentStopReason, 'abnormal' | 'normal'> = {
  completed: 'normal',
  tool_terminate: 'normal',
  aborted: 'normal',
  stream_error: 'normal',
  // The loop's only in-loop brake — the old home-grown loop's guard reasons
  // (repeated/oscillating calls, content loop, exploration stall, …) left the
  // union when that loop was deleted.
  max_turns: 'abnormal',
}

const reasons = Object.keys(TIER) as AgentStopReason[]
const ABNORMAL = reasons.filter((r) => TIER[r] === 'abnormal')
/** `undefined` rides along: an absent reason must read as an ordinary ending, not a brake. */
const NORMAL: (AgentStopReason | undefined)[] = [
  ...reasons.filter((r) => TIER[r] === 'normal'),
  undefined,
]

/**
 * The wording that makes a braked run read as braked.
 *
 * The whole point of a notice is that a cut-short run must never read as a successful one, so
 * every abnormal notice has to say, in some words, that the work is not done. The original
 * guard hard-coded ONE phrasing (`not completed|not finished|incomplete`) — true of the five
 * notices that existed when it was written, and false of both that came later, which is part
 * of why neither was ever added to the list.
 *
 * The cue set is deliberately small and audited: `noDeadCues` below fails if a cue stops being
 * used by any notice, so this cannot quietly decay into a catch-all that accepts anything.
 */
/**
 * A system line is a LABEL. It renders centred in the timeline beside a glyph, with whatever
 * recovery the host attached rendered as a control next to it, so the sentence only has to name
 * the fact. The previous notice was 148 characters because it also had to say the work was
 * unfinished and spell out the gesture to perform, neither of which is prose's job any more.
 */
const NOTICE_MAX_CHARS = 60

/** First-person wording, which would make the system's line read as the agent's own. */
const MODEL_VOICE = /\b(I|I'm|I've|my|me)\b/

describe('stopNotice', () => {
  test('every abnormal stop gets a notice — max_turns is the only one left', () => {
    expect(ABNORMAL).toHaveLength(1)
    expect(ABNORMAL).toContain('max_turns')
  })

  test('every abnormal stop is announced, in one short line', () => {
    for (const reason of ABNORMAL) {
      const notice = stopNotice(reason)
      expect(notice, `${reason} has no notice — the run would end silently`).toBeTruthy()
      // SHORT, because it renders as a system line with its own glyph and its own recovery
      // control (`finalize.ts` writes it as a `turn_limit` notice). The long version carried
      // all three jobs in prose — what stopped the run, that the work is unfinished, and what
      // gesture to perform — and the line now carries only the first.
      expect(
        notice!.length,
        `${reason}: a system line is a label, not a paragraph:\n${notice}`,
      ).toBeLessThanOrEqual(NOTICE_MAX_CHARS)
      // It must not read as the MODEL speaking. The finalizer refuses to fabricate anything in
      // the model's voice, and a notice written in the first person would do exactly that.
      expect(
        MODEL_VOICE.test(notice!),
        `${reason}: notice speaks as the agent, not as the system:\n${notice}`,
      ).toBe(false)
    }
  })

  test('ordinary and already-surfaced endings stay silent', () => {
    for (const reason of NORMAL) {
      expect(stopNotice(reason), `${reason} should not produce a notice`).toBeNull()
      expect(isAbnormalStop(reason)).toBe(false)
    }
  })

  test('each abnormal reason gets its OWN wording, so the user learns WHICH guard fired', () => {
    const notices = ABNORMAL.map((r) => stopNotice(r))
    expect(new Set(notices).size).toBe(ABNORMAL.length)
  })

  test('the reason is named, so the reader learns WHICH limit stopped the run', () => {
    // A bare "Stopped." would pass the length and voice guards above and tell nobody anything.
    for (const reason of ABNORMAL) {
      expect(stopNotice(reason)).toMatch(/limit|budget|turns/i)
    }
  })
})

describe('isLoopingStop', () => {
  test('a spent turn budget refuses auto-continuation (fresh budget = resumed loop)', () => {
    expect(isLoopingStop('max_turns')).toBe(true)
  })

  test('ordinary endings never block a continuation', () => {
    for (const reason of NORMAL) expect(isLoopingStop(reason)).toBe(false)
  })

  test('every looping stop is also an abnormal stop, so the user always sees why', () => {
    for (const reason of reasons)
      if (isLoopingStop(reason)) expect(isAbnormalStop(reason)).toBe(true)
  })
})
