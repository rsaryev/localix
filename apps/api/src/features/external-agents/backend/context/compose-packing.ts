import type { TranscriptSlice, TranscriptEvent } from '../../shared/contracts'
import type { ComposeSection } from './compose-types'
import { clipEvent, costOf, totalChars } from './compose-cost'

/**
 * How many times the leftover budget is offered around before giving up.
 *
 * A bound rather than a `while (leftover > 0)`: every round must make progress or it stops anyway,
 * and a fixed ceiling means a pathological slice cannot turn a compose into a long loop.
 */
const MAX_FILL_ROUNDS = 32

/**
 * Section order: most recently updated session first, ties broken by key so the output is stable
 * across calls. Deterministic ordering matters because this text is fed to a model, and an
 * order that shuffles between calls destroys prompt-cache reuse for no benefit.
 */
export function sectionOrder(a: TranscriptSlice, b: TranscriptSlice): number {
  const byTime = b.summary.updatedAt - a.summary.updatedAt
  return byTime !== 0 ? byTime : a.key.localeCompare(b.key)
}

/** Allocate body shares and pack events before measuring the final rendered answer. */
export function packSections(
  kept: readonly TranscriptSlice[],
  bodyBudget: number,
  budget: number,
  headerReserve: number,
) {
  // Fair share first, then a second pass hands unused share to sections that want more. Without
  // the second pass, linking one long session and three short ones wastes three quarters of the
  // budget.
  const share = Math.floor(bodyBudget / kept.length)
  const planned = kept.map((slice) => ({ slice, allocated: share }))
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
   * The loop below stops at the first event that does not fit, which leaves whatever is left of
   * that section's allocation unspent — and nothing was collecting it. With several sessions
   * against a mid-sized budget, well under half of what was asked for was rendered while thousands
   * of events were withheld for want of room. The dip is worst in the middle, because a large
   * budget makes each remainder small next to the whole.
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

  return { fills, sections }
}
