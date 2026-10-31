/**
 * What one `/loop` round tells the next.
 *
 * A `target: 'subsession'` loop runs every round in a FRESH child session, which is what
 * keeps the parent's history flat no matter how often it fires. The cost was amnesia: the
 * child received only the loop's prompt, so round 7 rediscovered what round 6 had already
 * established.
 *
 * The handoff is the narrow channel between rounds. Deliberately NOT the transcript: piping
 * the previous child's conversation in would reintroduce exactly the growth the subsession
 * target exists to avoid. What travels is the round's FINAL REPLY, bounded — a sub-session is
 * an ordinary session, and its last message is its report, the same way a delegated child or
 * a delegated task run reports. Nothing is parsed out of it and nothing is routed on it: the
 * schedule ends a loop, the user ends a loop, a round does not.
 */

export interface LoopHandoff {
  /** The previous round's final reply, bounded. */
  summary: string
}

/** Bound the inherited text so an over-eager round cannot grow the next round's prompt. */
export const MAX_HANDOFF_CHARS = 2_000

const clamp = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

/** The round's report, or nothing when it said nothing. */
export function handoffFromFinalText(text: string | null | undefined): LoopHandoff | undefined {
  const trimmed = text?.trim()
  return trimmed ? { summary: clamp(trimmed, MAX_HANDOFF_CHARS) } : undefined
}

/** Render what the previous round handed over, for the top of the next round's prompt. */
export function renderInheritedHandoff(handoff: LoopHandoff, round: number): string {
  return `Previous round (#${round}) reported:\n${handoff.summary}`
}

/**
 * Re-read a STORED handoff (the parsed `handoff` of a loop's payload). It is re-validated
 * rather than trusted so one that is not a handoff leaves the loop inheriting NOTHING instead of
 * feeding a malformed object into the next round's prompt.
 */
export function readLoopHandoff(value: unknown): LoopHandoff | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return handoffFromFinalText((value as { summary?: unknown }).summary as string | undefined)
}
