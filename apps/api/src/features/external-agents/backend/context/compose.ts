/**
 * Compose context from SEVERAL linked external sessions at once.
 *
 * ── ORDERING: why this does NOT produce a unified timeline ────────────────────────────────────
 *
 * The tempting output is one merged, timestamp-sorted stream. We do not produce it, and the reason
 * is not conservatism:
 *
 *  1. The clock sources are not the same instrument. Claude Code writes ISO-8601 strings stamped
 *     when a message record is appended; Codex stamps its own event envelope; opencode stores
 *     `time_created` integers written by a different process; Gemini CLI stamps per recording.
 *     Even on one machine these are different processes sampling the wall clock at different
 *     points in their own pipelines.
 *  2. Transcripts are portable. A history directory can be restored from a backup, synced, or
 *     copied between machines, at which point the timestamps are from a clock we never saw. There
 *     is no field in any of these formats that identifies the clock, so we cannot detect this.
 *  3. Most importantly, interleaving ASSERTS something. Placing agent A's turn 5 immediately after
 *     agent B's turn 3 reads as causal adjacency to any reader, human or model. Between two
 *     independent agents that relationship almost never exists. A wrong merge is worse than an
 *     honest split — it manufactures a narrative.
 *
 * So: labelled sections, one per linked session, in a documented deterministic order; events
 * ordered WITHIN a section by `ordinal`, which is the one ordering we can defend (it is the
 * provider's own append order in its own file or table). Absolute timestamps are printed on each
 * section so a reader can correlate two sections deliberately, which is different from us
 * pretending to have done it for them. When section time ranges overlap, we say so explicitly
 * rather than leaving the reader to assume they are sequential.
 *
 * ── BUDGET: bounded, and it says what it withheld ─────────────────────────────────────────────
 *
 * N transcripts must not blow the context window. The budget is split fairly across sections and
 * unused share is redistributed, so one short session does not waste its allocation. Everything
 * dropped is COUNTED and reported, per section and in total. Nothing is truncated silently.
 */

import type { TranscriptSlice, TranscriptEvent } from '../../shared/contracts'
import type { ComposeSection, ComposeResult } from './compose-types'
import { MAX_EVENT_CHARS, PER_EVENT_OVERHEAD, costOf } from './compose-cost'
import { hasOverlap, render } from './compose-render'
import { sectionOrder, packSections } from './compose-packing'

export type { ComposeSection, ComposeResult } from './compose-types'
export { MAX_EVENT_CHARS } from './compose-cost'

/** Default total character budget. Roughly 30k tokens — large enough to be useful, small enough to bound. */
export const DEFAULT_BUDGET_CHARS = 120_000
export const MAX_BUDGET_CHARS = 400_000
/**
 * What one section's header costs before a single event is rendered: key, cwd, source path, time range
 * and the events line. Measured against real sections rather than guessed — the longest here run to
 * roughly 300 characters, and the figure is the budget's own accounting unit.
 */
export const PER_SECTION_RESERVE = 320

/** Bound on the trim-to-fit pass; each round removes one event, so it terminates on its own. */
const MAX_TRIM_ROUNDS = 512

/** How many omitted keys the note spells out before it starts counting instead. */
export const NAMED_OMISSIONS = 5

/** Below this a section is a header with nothing under it, so the count gives way instead. */
export const MIN_BODY_CHARS = 1_000

/**
 * The least a foothold event may show. Below this a section would carry a header, an ellipsis and no
 * readable content — which costs more than it says.
 */
const MIN_FOOTHOLD_CHARS = 200

/**
 * What was left out entirely, said once and bounded.
 *
 * Naming every omission looked like the honest choice and broke the ceiling it was added to
 * protect: 30 real keys (`claude-code:cc71d515-…`, 48 characters each) made a 1,898-character note
 * and a 2,869-character answer against a 2,000 budget. A disclosure that overruns the bound is the
 * bug it discloses. Enough keys to act on, then a count.
 */
function omissionNote(keys: readonly string[], keptSections: number): string {
  const named = keys.slice(0, NAMED_OMISSIONS)
  const rest = keys.length - named.length
  return `${keys.length} session(s) were not included at all: this character budget carries ${keptSections} labelled section(s) before any events are rendered. Ask for fewer sessions, or raise budgetChars. Omitted: ${named.join(
    ', ',
  )}${rest > 0 ? `, and ${rest} more` : ''}.`
}

export function compose(slices: readonly TranscriptSlice[], budgetChars: number): ComposeResult {
  const budget = Math.min(Math.max(budgetChars, 2_000), MAX_BUDGET_CHARS)
  const ordered = [...slices].sort(sectionOrder)
  const notes: string[] = []

  if (ordered.length === 0) {
    return {
      sections: [],
      text: '',
      totalWithheldEvents: 0,
      budgetChars: budget,
      usedChars: 0,
      notes,
    }
  }

  /**
   * The budget covers HEADERS too, and with enough sections it cannot cover anything else.
   *
   * Measured: ten sections against the smallest budget the schema allows (2,000) produced 2,976
   * characters — 976 over a documented hard ceiling. The reserve for ten headers is 3,200 on its own,
   * so `bodyBudget` fell to its 1,000 floor and the headers were charged to nobody. Reachable with an
   * ordinary call: ten keys and `budgetChars: 2000`.
   *
   * A ceiling that yields is not a ceiling, so the SECTION COUNT bends instead — as many as the budget
   * can carry, most recent first, and the rest are named in a note like every other bound here. At
   * least one always survives: a caller asking for context gets a session, not an apology.
   */
  // The body floor is part of the sum, so it has to be RESERVED, not discovered afterwards: leaving
  // it out let six sections through, spend 1,920 on headers, and then take the 1,000 floor anyway.
  const affordable = Math.max(1, Math.floor((budget - MIN_BODY_CHARS) / PER_SECTION_RESERVE))
  const dropped = ordered.slice(affordable)
  const kept = ordered.slice(0, affordable)
  const headerReserve = kept.length * PER_SECTION_RESERVE
  const bodyBudget = Math.max(MIN_BODY_CHARS, budget - headerReserve)

  const { fills, sections } = packSections(kept, bodyBudget, budget, headerReserve)

  if (sections.length > 1) {
    notes.push(
      `${sections.length} sessions are presented as separate labelled sections, not merged into one timeline. Events are ordered within each section by the provider's own append order. Timestamps across providers come from different processes and are not sorted against each other.`,
    )
    if (hasOverlap(sections)) {
      notes.push(
        'The time ranges of two or more sections overlap, so these agents were running concurrently. Section order does not imply that one happened before another.',
      )
    }
  }

  if (dropped.length > 0) {
    /**
     * The note is bounded too, because it is part of the answer it describes.
     *
     * Naming every omission looked like the honest choice and broke the ceiling it was added to
     * protect: 30 real keys (`claude-code:cc71d515-…`, 48 characters each) made a 1,898-character note
     * and a 2,869-character answer against a 2,000 budget. A disclosure that overruns the bound is the
     * bug it discloses. Enough keys to act on, then a count.
     */
    notes.push(
      omissionNote(
        dropped.map((slice) => slice.key),
        kept.length,
      ),
    )
  }

  let totalWithheld = sections.reduce((sum, s) => sum + s.withheldEvents, 0)

  /**
   * The ceiling is what the ANSWER costs, so it is checked against the answer.
   *
   * `PER_SECTION_RESERVE` is an estimate of a header, and an estimate is what it stays: a section
   * with a 60-character title and an 80-character path costs more than 320, and three of them
   * overran a 2,000 budget the moment the remainder began being spent — the under-spending had been
   * hiding it. So the rendered text is measured, and the last events come back off until it fits.
   * Costed on the RENDERED string rather than on event text, because the header, the notes and the
   * separators are part of what a caller is paying for.
   */
  /**
   * The withheld note is written AFTER the trim, because the trim withholds more.
   *
   * Written before it, the note stated a count the answer then invalidated by one per trimmed
   * event — a disclosure that is wrong about the thing it discloses. It also changes the answer's
   * own length, so it has to be in place before the fit is measured.
   */
  const omitted: string[] = dropped.map((slice) => slice.key)
  const withNote = (count: number): string =>
    render(sections, [
      ...notes,
      ...(omitted.length > 0 ? [omissionNote(omitted, sections.length)] : []),
      ...(count > 0
        ? [
            `${count} event(s) were withheld to stay within the ${budget.toLocaleString('en-US')}-character budget. Each section reports its own withheld count; request a single session for its full transcript.`,
          ]
        : []),
    ])

  let text = withNote(totalWithheld)
  for (let guard = 0; text.length > budget && guard < MAX_TRIM_ROUNDS; guard += 1) {
    const widest = sections.reduce<ComposeSection | undefined>(
      (worst, section) =>
        section.events.length > 0 && (!worst || section.renderedChars > worst.renderedChars)
          ? section
          : worst,
      undefined,
    )
    if (!widest) {
      /**
       * Nothing left to trim, and still over: the HEADERS alone exceed the budget.
       *
       * `PER_SECTION_RESERVE` bends the section count up front, but it is an estimate — measured
       * here, two sections with a 400-character title and a 400-character path cost 2,291 characters
       * against a 2,000 budget with every event already withheld. A ceiling that yields is not a
       * ceiling, so the section count bends again, now against the real cost, and the section leaves
       * by the same door as the ones the estimate excluded: named in the omission note.
       */
      if (sections.length <= 1) break
      const evicted = sections.pop()
      if (!evicted) break
      omitted.push(evicted.key)
      totalWithheld += evicted.withheldEvents
      text = withNote(totalWithheld)
      continue
    }
    const index = sections.indexOf(widest)
    const events = [...widest.events]
    // A tail slice reads forwards but was trimmed from its end; drop from the end either way, so the
    // section keeps the side it was read for.
    const dropped = events.pop()
    if (!dropped) break
    sections[index] = {
      ...widest,
      events,
      renderedChars: Math.max(0, widest.renderedChars - costOf(dropped.text)),
      withheldEvents: widest.withheldEvents + 1,
    }
    totalWithheld += 1
    text = withNote(totalWithheld)
  }

  /**
   * A FOOTHOLD for any section that could afford nothing — taken from what the measured answer
   * leaves, not from an estimated share.
   *
   * A single event may cost up to `MAX_EVENT_CHARS` while a share is `bodyBudget / sections`, so a
   * section whose first event is larger than its share renders NOTHING and still pays for its
   * header. Measured on a real local history: four real sessions at a 9,000-character budget produced two
   * sections of zero events, one of them a nine-event session that showed none of them at any budget
   * from 7,000 to 11,000.
   *
   * It runs LAST because it lost when it ran first: footholds sized against the shares spent the
   * whole body budget, the real headers pushed the answer past its ceiling, and the trim took them
   * straight back off one at a time. Sized against `budget - text.length`, a foothold is only ever
   * taken when it fits.
   */
  const needy = fills.filter((fill) => fill.taken.length === 0 && fill.cursor < fill.queue.length)
  for (const [position, fill] of needy.entries()) {
    const index = sections.findIndex((section) => section.key === fill.plan.slice.key)
    if (index < 0) continue
    // Shared among the sections that still need one, so the first does not eat the room the rest
    // were owed — it took 3,824 of 4,559 characters and left the next section empty.
    const remaining = needy.length - position
    const room = Math.floor((budget - text.length) / remaining) - PER_EVENT_OVERHEAD
    if (room < MIN_FOOTHOLD_CHARS) continue
    const event = fill.queue[fill.cursor] as TranscriptEvent
    const section = sections[index] as ComposeSection
    const before = { text, totalWithheld }
    /**
     * Try, measure, shrink. The renderer adds separators of its own, so the room a cost model
     * predicts is not the room the answer has — the first version handed a section 1,417 characters
     * of a 1,441-character gap and had to put the whole foothold back. Halving clears that margin,
     * and a foothold that still will not fit is simply not taken.
     */
    for (let width = Math.min(room, MAX_EVENT_CHARS); width >= MIN_FOOTHOLD_CHARS; width >>= 1) {
      /**
       * Only claim a cut when there was one: an ellipsis on a whole event tells the reader they are
       * missing something they are not.
       *
       * Defensive rather than exercised — a section reaches here only because its first event did
       * not fit, and any room large enough to hold it whole would have been spent by the remainder
       * pass before this one runs. Kept because the two passes are separated by a re-render and the
       * invariant is theirs, not this loop's.
       */
      const clipped = event.text.length > width ? `${event.text.slice(0, width - 1)}…` : event.text
      sections[index] = {
        ...section,
        events: [{ ...event, text: clipped }],
        renderedChars: costOf(clipped),
        withheldEvents: Math.max(0, section.withheldEvents - 1),
      }
      totalWithheld = Math.max(0, before.totalWithheld - 1)
      text = withNote(totalWithheld)
      if (text.length <= budget) break
      sections[index] = section
      totalWithheld = before.totalWithheld
      text = before.text
    }
  }

  return {
    sections,
    text,
    totalWithheldEvents: totalWithheld,
    budgetChars: budget,
    usedChars: text.length,
    notes: [
      ...notes,
      ...(omitted.length > 0 ? [omissionNote(omitted, sections.length)] : []),
      ...(totalWithheld > 0
        ? [
            `${totalWithheld} event(s) were withheld to stay within the ${budget.toLocaleString('en-US')}-character budget. Each section reports its own withheld count; request a single session for its full transcript.`,
          ]
        : []),
    ],
  }
}
