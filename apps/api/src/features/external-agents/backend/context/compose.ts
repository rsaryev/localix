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

/** Default total character budget. Roughly 30k tokens — large enough to be useful, small enough to bound. */
export const DEFAULT_BUDGET_CHARS = 120_000
export const MAX_BUDGET_CHARS = 400_000
/**
 * What one section's header costs before a single event is rendered: key, cwd, source path, time range
 * and the events line. Measured against real sections rather than guessed — the longest here run to
 * roughly 300 characters, and the figure is the budget's own accounting unit.
 */
export const PER_SECTION_RESERVE = 320

/**
 * How many times the leftover budget is offered around before giving up.
 *
 * A bound rather than a `while (leftover > 0)`: every round must make progress or it stops anyway,
 * and a fixed ceiling means a pathological slice cannot turn a compose into a long loop.
 */
const MAX_FILL_ROUNDS = 32

/** Bound on the trim-to-fit pass; each round removes one event, so it terminates on its own. */
const MAX_TRIM_ROUNDS = 512

/** How many omitted keys the note spells out before it starts counting instead. */
export const NAMED_OMISSIONS = 5

/** Below this a section is a header with nothing under it, so the count gives way instead. */
export const MIN_BODY_CHARS = 1_000

/** No single event may eat a whole section's share. */
export const MAX_EVENT_CHARS = 4_000

/**
 * The least a foothold event may show. Below this a section would carry a header, an ellipsis and no
 * readable content — which costs more than it says.
 */
const MIN_FOOTHOLD_CHARS = 200

export interface ComposeSection {
  readonly key: string
  /** The adapter's byte cap cut the source, so its positions are not the session's. */
  readonly sourceTruncated?: boolean
  /** Which end the read came from — the one end-claim a truncated slice CAN support. */
  readonly readFrom?: 'head' | 'tail'
  readonly provider: string
  readonly title: string
  readonly cwd?: string
  readonly sourcePath: string
  readonly events: readonly TranscriptEvent[]
  readonly renderedChars: number
  readonly withheldEvents: number
  readonly totalEvents: number
  readonly earliest?: number
  readonly latest?: number
}

export interface ComposeResult {
  readonly sections: readonly ComposeSection[]
  readonly text: string
  readonly totalWithheldEvents: number
  readonly budgetChars: number
  readonly usedChars: number
  /** Human-readable notes about ordering and budget. Always surfaced; never silently applied. */
  readonly notes: readonly string[]
}

/**
 * Section order: most recently updated session first, ties broken by key so the output is stable
 * across calls. Deterministic ordering matters because this text is fed to a model, and an
 * order that shuffles between calls destroys prompt-cache reuse for no benefit.
 */
function sectionOrder(a: TranscriptSlice, b: TranscriptSlice): number {
  const byTime = b.summary.updatedAt - a.summary.updatedAt
  return byTime !== 0 ? byTime : a.key.localeCompare(b.key)
}

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

  // Fair share first, then a second pass hands unused share to sections that want more. Without
  // the second pass, linking one long session and three short ones wastes three quarters of the
  // budget.
  const share = Math.floor(bodyBudget / kept.length)
  const planned = kept.map((slice) => ({ slice, allocated: share, used: 0 }))
  let spare = bodyBudget - share * kept.length
  for (const plan of planned) {
    const want = totalChars(plan.slice.events)
    if (want < plan.allocated) {
      spare += plan.allocated - want
      plan.allocated = want
    }
  }
  for (const plan of planned) {
    if (spare <= 0) break
    const want = totalChars(plan.slice.events)
    if (want > plan.allocated) {
      const extra = Math.min(spare, want - plan.allocated)
      plan.allocated += extra
      spare -= extra
    }
  }

  /**
   * Per-plan fill state, so the budget's REMAINDER can be spent after every section has taken its
   * share.
   *
   * The loop below stops at the first event that does not fit, which leaves whatever is left of that
   * section's allocation unspent — and nothing was collecting it. Measured on a real local history, four
   * real sessions against a 12,000-character budget rendered 5,133 characters, 43% of what was
   * asked for, while 9,842 events were withheld for want of room. The dip is worst in the middle:
   * 79% at 4,000, 43% at 12,000, 92% at 48,000, because a large budget makes each remainder small
   * next to the whole.
   */
  const fills = planned.map((plan) => {
    // A slice read from the END is trimmed from the end too — see the note below.
    const fromEnd = (plan.slice.events[0]?.ordinal ?? 0) > 0
    return {
      plan,
      fromEnd,
      queue: fromEnd ? [...plan.slice.events].reverse() : [...plan.slice.events],
      taken: [] as TranscriptEvent[],
      used: 0,
      cursor: 0,
    }
  })

  /**
   * A slice read from the END must be trimmed from the end too.
   *
   * Measured before this existed: a tail read of a 3,893-event session delivered positions
   * 3,494–3,564. The adapter had kept the last 400 as asked, and then the trim kept the OLDEST 71 of
   * those — so "the latest" stopped 329 events short of the latest, in the direction nobody asked
   * for. The direction is derived from the payload (a tail slice does not begin at ordinal 0) rather
   * than passed in, so it cannot disagree with what was actually read.
   */
  const take = (fill: (typeof fills)[number], ceiling: number): number => {
    let spent = 0
    while (fill.cursor < fill.queue.length) {
      const event = fill.queue[fill.cursor] as TranscriptEvent
      const text = clipEvent(event.text)
      const cost = costOf(text)
      if (fill.used + spent + cost > ceiling) break
      spent += cost
      fill.taken.push(text === event.text ? event : { ...event, text })
      fill.cursor += 1
    }
    fill.used += spent
    return spent
  }

  /**
   * What the BODY may cost, measured against the answer rather than against the share.
   *
   * `bodyBudget` carries a floor so a small budget still renders something, and `PER_SECTION_RESERVE`
   * only estimates a header — so the shares can add up to more than the answer may spend. Every pass
   * below is bounded by this one figure, which is what stops the foothold pass and the trim from
   * fighting: footholds worth 2 × 2,680 spent the whole body budget, the real headers pushed the
   * answer over, and the trim took one of them straight back off.
   */
  const spendable = Math.min(bodyBudget, Math.max(0, budget - headerReserve))
  const spent = () => fills.reduce((sum, fill) => sum + fill.used, 0)

  // Fair share first…
  for (const fill of fills) take(fill, fill.plan.allocated)

  /**
   * …then the REMAINDER, round by round.
   *
   * Each section stops at the first event too large for what is left of its share, and that tail of
   * its allocation belonged to nobody. One pass per round, one event at a time, so a section with
   * many small events cannot swallow what several others could have used — the fair-share intent
   * survives, and only the crumbs are re-spent.
   */
  /**
   * The remainder is measured against what the ANSWER may cost, not against the body allocation.
   *
   * `bodyBudget` carries a floor (`MIN_BODY_CHARS`) so a small budget still renders something, which
   * means it can exceed what is actually left once headers are paid for. Spending down to it was the
   * first version of this pass, and it pushed a three-section answer past the ceiling it was written
   * to respect — caught by the test that has guarded that ceiling since it was written.
   */
  let leftover = spendable - spent()
  for (let round = 0; leftover > 0 && round < MAX_FILL_ROUNDS; round += 1) {
    let progressed = false
    for (const fill of fills) {
      if (leftover <= 0) break
      const before = fill.used
      take(fill, fill.used + leftover)
      const spent = fill.used - before
      if (spent > 0) {
        leftover -= spent
        progressed = true
      }
    }
    if (!progressed) break
  }

  const sections: ComposeSection[] = []
  for (const fill of fills) {
    const plan = fill.plan
    // Chronological again: the section reads forwards however it was trimmed.
    const kept = fill.fromEnd ? [...fill.taken].reverse() : fill.taken
    const stamps = kept.map((e) => e.timestamp).filter((t): t is number => typeof t === 'number')
    sections.push({
      key: plan.slice.key,
      provider: plan.slice.summary.provider,
      title: plan.slice.summary.title,
      cwd: plan.slice.summary.cwd,
      sourcePath: plan.slice.summary.sourcePath,
      events: kept,
      renderedChars: fill.used,
      // Withheld = dropped by OUR budget here, plus whatever the adapter's own read cap withheld.
      withheldEvents: plan.slice.events.length - kept.length + plan.slice.withheld,
      totalEvents: plan.slice.total,
      earliest: stamps.length > 0 ? Math.min(...stamps) : undefined,
      latest: stamps.length > 0 ? Math.max(...stamps) : undefined,
      ...(plan.slice.sourceTruncated ? { sourceTruncated: true } : {}),
      ...(plan.slice.readFrom ? { readFrom: plan.slice.readFrom } : {}),
    })
  }

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

/**
 * Planning and packing MUST cost an event identically. They used to differ by one character — the
 * ellipsis added when clipping — which made a section's whole allocation one short of its single
 * oversized event, so that event was dropped entirely instead of being included clipped.
 */
const PER_EVENT_OVERHEAD = 24

function clipEvent(text: string): string {
  return text.length > MAX_EVENT_CHARS ? `${text.slice(0, MAX_EVENT_CHARS)}…` : text
}

function costOf(text: string): number {
  return text.length + PER_EVENT_OVERHEAD
}

function totalChars(events: readonly TranscriptEvent[]): number {
  let sum = 0
  for (const event of events) sum += costOf(clipEvent(event.text))
  return sum
}

function hasOverlap(sections: readonly ComposeSection[]): boolean {
  const ranges = sections
    .filter((s) => s.earliest !== undefined && s.latest !== undefined)
    .map((s) => [s.earliest as number, s.latest as number] as const)
    .sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i][0] <= ranges[i - 1][1]) return true
  }
  return false
}

function iso(ms: number | undefined): string {
  return ms === undefined ? 'unknown' : new Date(ms).toISOString()
}

/**
 * WHICH events a section holds, not merely how many.
 *
 * Measured on a real local history: pulling context for the five largest sessions delivered 175 of 23,147
 * events — 0.76%. At that ratio the window IS the answer, and "49 shown of 8596" describes it no
 * better than silence does. Derived from the payload's own ordinals rather than from the caller's
 * `tail` request, so it stays true when the character budget lands the window at neither end.
 */
function windowOf(section: ComposeSection): string {
  /**
   * A capped source cannot support POSITIONS — its own `total` counts only what fitted, so a position
   * within the window is not a position within the session. It can support the END, and that is the
   * useful half: a tail read of an oversized file reads backwards and really does finish where the
   * session finishes, a head read really does start where it starts. Saying neither, which this did
   * for a day, is as wrong as naming the wrong one.
   */
  if (section.sourceTruncated) {
    const count = section.events.length
    if (count === 0) return ''
    const end = section.readFrom === 'tail' ? 'the latest' : 'the opening'
    return ` (${count} — ${end}, from a source too large to read whole)`
  }
  const ordinals = section.events.map((event) => event.ordinal)
  if (ordinals.length === 0 || ordinals.some((ordinal) => ordinal === undefined)) return ''
  const positions = ordinals as readonly number[]
  const first = Math.min(...positions) + 1
  const last = Math.max(...positions) + 1
  // The whole session is present; there is no window to name.
  if (first === 1 && last === section.totalEvents) return ''
  const end = first === 1 ? ' — the opening' : last === section.totalEvents ? ' — the latest' : ''
  return ` (positions ${first}–${last}${end})`
}

function render(sections: readonly ComposeSection[], notes: readonly string[]): string {
  const out: string[] = ['# External agent sessions', '']
  for (const note of notes) out.push(`> ${note}`, '')
  for (const section of sections) {
    out.push(`## ${section.provider} — ${section.title}`)
    out.push(`- key: \`${section.key}\``)
    if (section.cwd) out.push(`- cwd: \`${section.cwd}\``)
    out.push(`- source: \`${section.sourcePath}\``)
    out.push(`- time range: ${iso(section.earliest)} → ${iso(section.latest)}`)
    out.push(
      `- events: ${section.events.length} of ${section.totalEvents}${windowOf(section)}${
        section.withheldEvents > 0 ? `, ${section.withheldEvents} withheld` : ''
      }`,
    )
    out.push('')
    for (const event of section.events) out.push(`**${event.role}**: ${event.text}`, '')
  }
  return out.join('\n')
}
