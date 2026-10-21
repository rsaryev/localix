import { describe, expect, it } from 'bun:test'
import { compose, DEFAULT_BUDGET_CHARS } from './compose'
import type { TranscriptSlice, TranscriptEvent } from '../../shared/contracts'

function event(
  provider: string,
  ordinal: number,
  text: string,
  timestamp?: number,
): TranscriptEvent {
  return {
    provider,
    nativeSessionId: 'n1',
    role: ordinal % 2 === 0 ? 'user' : 'assistant',
    ordinal,
    text,
    timestamp,
  }
}

function slice(
  key: string,
  provider: string,
  events: TranscriptEvent[],
  updatedAt = 1_000,
  withheld = 0,
): TranscriptSlice {
  return {
    key,
    summary: {
      key,
      provider,
      nativeSessionId: 'n1',
      title: `${provider} session`,
      updatedAt,
      sourcePath: `/tmp/${provider}.jsonl`,
    },
    events,
    withheld,
    total: events.length + withheld,
  }
}

describe('compose — ordering', () => {
  it('keeps each session in its own labelled section rather than interleaving', () => {
    // Timestamps deliberately interleave: a merged timeline would alternate A,B,A,B. The whole
    // point of the design is that it must not.
    const a = slice('claude-code:1', 'claude-code', [
      event('claude-code', 0, 'alpha-one', 1_000),
      event('claude-code', 1, 'alpha-two', 3_000),
    ])
    const b = slice('codex:2', 'codex', [
      event('codex', 0, 'beta-one', 2_000),
      event('codex', 1, 'beta-two', 4_000),
    ])
    const result = compose([a, b], DEFAULT_BUDGET_CHARS)
    expect(result.sections).toHaveLength(2)
    const alphaOne = result.text.indexOf('alpha-one')
    const alphaTwo = result.text.indexOf('alpha-two')
    const betaOne = result.text.indexOf('beta-one')
    // Both of A's events precede both of B's — sections, not a merged stream.
    expect(alphaTwo).toBeGreaterThan(alphaOne)
    expect(betaOne).toBeGreaterThan(alphaTwo)
  })

  it('states plainly that sections are not merged, and flags overlapping ranges', () => {
    const a = slice('claude-code:1', 'claude-code', [
      event('claude-code', 0, 'x', 1_000),
      event('claude-code', 1, 'y', 5_000),
    ])
    const b = slice('codex:2', 'codex', [
      event('codex', 0, 'p', 2_000),
      event('codex', 1, 'q', 6_000),
    ])
    const result = compose([a, b], DEFAULT_BUDGET_CHARS)
    expect(result.notes.join(' ')).toContain('not merged into one timeline')
    expect(result.notes.join(' ')).toContain('overlap')
  })

  it('is deterministic across calls, so the prompt stays cacheable', () => {
    const a = slice('claude-code:1', 'claude-code', [event('claude-code', 0, 'x')], 5_000)
    const b = slice('codex:2', 'codex', [event('codex', 0, 'y')], 5_000)
    expect(compose([a, b], DEFAULT_BUDGET_CHARS).text).toBe(
      compose([b, a], DEFAULT_BUDGET_CHARS).text,
    )
  })
})

describe('compose — which END of a session a section holds', () => {
  const many = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      event('codex', from + i, `event ${from + i} `.repeat(8)),
    )

  /**
   * A slice read from the END must be trimmed from the end.
   *
   * Before this held, a tail read of a few thousand events kept the last 400 as asked, then the
   * budget loop kept the OLDEST of those — so "the latest" stopped hundreds of events short of it.
   * Nothing in the output said so, because a count ("71 of 3893") cannot.
   */
  it('keeps the newest events of a tail slice, still in reading order', () => {
    const tail = slice('codex:s1', 'codex', many(900, 100), 1_000, 900)
    const result = compose([tail], 2_000)
    const kept = result.sections[0]!.events

    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(100)
    // Reaches the actual end, rather than the oldest of the window that was read.
    expect(kept[kept.length - 1]!.ordinal).toBe(999)
    // Forwards, however it was trimmed: a section that reads backwards is a different lie.
    const ordinals = kept.map((e) => e.ordinal as number)
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals)
    expect(result.text).toContain('— the latest')
  })

  it('keeps the opening of a head slice and names it that', () => {
    const head = slice('codex:s2', 'codex', many(0, 100), 1_000, 900)
    const result = compose([head], 2_000)
    const kept = result.sections[0]!.events

    expect(kept[0]!.ordinal).toBe(0)
    expect(result.text).toContain('— the opening')
  })

  it('names a window at neither end without claiming to be either', () => {
    // Reachable whenever an adapter's own cap lands mid-session. Any slice not starting at ordinal 0
    // is trimmed from its end, so this keeps the newest of the middle — and then must NOT call that
    // the latest, because 500 of 1000 is not the end of anything.
    const middle = slice('codex:s3', 'codex', many(400, 100), 1_000, 900)
    const result = compose([middle], 2_000)

    // Matched as a shape: which positions survive is the budget's arithmetic, not this claim.
    expect(result.text).toMatch(/\(positions \d+–\d+\), \d+ withheld/)
    expect(result.text).not.toContain('the latest')
    expect(result.text).not.toContain('the opening')
  })

  it('a source cut by the byte cap names its END but not its positions', () => {
    /**
     * A transcript past the 32 MB cap, read from the tail, reads BACKWARDS and finishes exactly
     * where the session finishes, so "the latest" is true — while the positions are not, because
     * `total` counts only what fitted.
     *
     * This asserted that NEITHER could be claimed, which was right while a "tail" was really the front
     * of the file and became an under-claim the day tail reads started reading backwards.
     */
    const cut = {
      ...slice('codex:s5', 'codex', many(0, 100), 1_000, 900),
      sourceTruncated: true,
      readFrom: 'tail' as const,
    }
    const result = compose([cut], 2_000)

    expect(result.text).toContain('the latest, from a source too large to read whole')
    expect(result.text).not.toContain('positions')
  })

  it('a cut HEAD read names the opening instead, on the same reasoning', () => {
    const cut = {
      ...slice('codex:s6', 'codex', many(0, 100), 1_000, 900),
      sourceTruncated: true,
      readFrom: 'head' as const,
    }

    expect(compose([cut], 2_000).text).toContain('the opening, from a source too large')
  })

  it('says nothing about a window when the whole session is present', () => {
    const whole = slice('codex:s4', 'codex', many(0, 3), 1_000, 0)
    const result = compose([whole], DEFAULT_BUDGET_CHARS)

    expect(result.sections[0]!.events).toHaveLength(3)
    expect(result.text).toContain('- events: 3 of 3')
    expect(result.text).not.toContain('positions')
  })
})

describe('compose — budget', () => {
  const long = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => event(tag, i, `${tag}-${i} ${'z'.repeat(500)}`))

  it('never exceeds the requested budget', () => {
    const result = compose([slice('a:1', 'claude-code', long(400, 'a'))], 20_000)
    expect(result.usedChars).toBeLessThanOrEqual(20_000)
  })

  it('reports what it withheld instead of truncating silently', () => {
    const result = compose([slice('a:1', 'claude-code', long(400, 'a'))], 20_000)
    expect(result.totalWithheldEvents).toBeGreaterThan(0)
    expect(result.sections[0].withheldEvents).toBe(result.totalWithheldEvents)
    expect(result.text).toContain('withheld')
    expect(result.notes.join(' ')).toContain('withheld')
  })

  it('carries the adapter’s own withheld count through, not just its own', () => {
    const result = compose(
      [slice('a:1', 'claude-code', long(2, 'a'), 1_000, 37)],
      DEFAULT_BUDGET_CHARS,
    )
    expect(result.sections[0].withheldEvents).toBe(37)
  })

  it('redistributes unused budget so one short session does not waste its share', () => {
    const short = slice('s:1', 'codex', [event('codex', 0, 'tiny')], 9_000)
    const big = slice('b:1', 'claude-code', long(200, 'b'), 8_000)
    const paired = compose([short, big], 40_000)
    const bigAlone = compose([big], 40_000)
    // With a naive equal split the big section would get ~half; redistribution should bring it
    // close to what it gets on its own.
    expect(paired.sections.find((s) => s.key === 'b:1')?.events.length ?? 0).toBeGreaterThan(
      (bigAlone.sections[0].events.length * 0.7) | 0,
    )
  })

  it('bounds a single oversized event rather than letting it consume a section', () => {
    const huge = slice('h:1', 'codex', [event('codex', 0, 'q'.repeat(50_000))])
    const result = compose([huge], DEFAULT_BUDGET_CHARS)
    expect(result.sections[0].events[0].text.length).toBeLessThanOrEqual(4_001)
  })

  it('handles an empty link set without producing a header for nothing', () => {
    const result = compose([], DEFAULT_BUDGET_CHARS)
    expect(result.text).toBe('')
    expect(result.sections).toHaveLength(0)
  })
})

describe('the budget is a ceiling on the WHOLE answer, headers included', () => {
  /**
   * It was not. Measured before this held: ten sections against the smallest budget the schema allows
   * (2,000) rendered 2,976 characters — 976 over a documented hard ceiling — because the reserve for
   * ten headers is 3,200 on its own, so the body budget fell to its floor and the headers were charged
   * to nobody. Reachable with an ordinary call: ten keys and `budgetChars: 2000`.
   *
   * A ceiling that yields is not a ceiling, so the section COUNT gives way instead.
   */
  const wide = (key: string) => ({
    ...slice(
      key,
      'codex',
      Array.from({ length: 40 }, (_, i) => event('codex', i, 'x'.repeat(400))),
    ),
    summary: {
      key,
      provider: 'codex',
      nativeSessionId: key,
      title: 't'.repeat(60),
      updatedAt: 1_000,
      sourcePath: `/tmp/${'p'.repeat(80)}`,
    },
  })

  it('stays inside the budget however many sessions are asked for', () => {
    for (const count of [1, 3, 10, 20]) {
      const result = compose(
        Array.from({ length: count }, (_, i) => wide(`codex:s${i}`)),
        2_000,
      )
      expect({ count, over: result.usedChars > result.budgetChars }).toEqual({ count, over: false })
    }
  })

  it('names the sessions it could not fit, rather than dropping them quietly', () => {
    const result = compose(
      Array.from({ length: 10 }, (_, i) => wide(`codex:s${i}`)),
      2_000,
    )

    expect(result.sections.length).toBeLessThan(10)
    const note = result.notes.find((line) => line.includes('not included at all'))
    expect(note).toBeDefined()
    // Omissions are NAMED, because a key is what the next call takes — bounded to the first few, with
    // the rest counted, since the note is part of the answer the budget covers.
    expect(note).toContain('codex:s3')
    expect(note).toContain('and 2 more')
  })

  it('the omission note is bounded too, because it is part of the answer', () => {
    /**
     * Naming every omission looked like the honest choice and broke the ceiling it was added to
     * protect. Measured with REAL key lengths (`claude-code:cc71d515-…`, 48 characters): 30 dropped
     * sessions made a 1,898-character note and a 2,869-character answer against a 2,000 budget. Short
     * fixture keys had hidden it entirely.
     */
    const many = (count: number) =>
      compose(
        Array.from({ length: count }, (_, i) =>
          wide(`claude-code:cc71d515-fee9-422c-a218-b12035${String(i).padStart(4, '0')}`),
        ),
        2_000,
      )

    const thirty = many(30)
    const twoHundred = many(200)

    expect(thirty.usedChars).toBeLessThanOrEqual(thirty.budgetChars)
    expect(twoHundred.usedChars).toBeLessThanOrEqual(twoHundred.budgetChars)
    // The note stops growing: enough keys to act on, then a count.
    const note = twoHundred.notes.find((line) => line.includes('not included at all')) ?? ''
    expect(note).toContain('and 192 more')
    expect(note.length).toBeLessThan(600)
  })

  it('always keeps at least one session, however small the budget', () => {
    const result = compose([wide('codex:only')], 2_000)

    expect(result.sections).toHaveLength(1)
  })

  it('a budget that can afford every section changes nothing', () => {
    const result = compose(
      Array.from({ length: 10 }, (_, i) => wide(`codex:s${i}`)),
      8_000,
    )

    expect(result.sections).toHaveLength(10)
    expect(result.notes.some((line) => line.includes('not included at all'))).toBe(false)
  })
})

describe('the budget is spent, not merely respected', () => {
  /**
   * Each section stopped at the first event too large for what was left of its share, and that tail
   * of its allocation belonged to nobody. With several sessions against a mid-sized budget, well
   * under half of what was asked for was rendered while thousands of events were withheld for want
   * of room. The dip was worst in the middle, since a large budget makes each remainder small next
   * to the whole; the remainder pass recovers most of it.
   */
  function slice(key: string, events: number, size: number) {
    return {
      key,
      summary: {
        key,
        provider: 'codex',
        nativeSessionId: key,
        title: key,
        updatedAt: 1_000,
        sourcePath: `/tmp/${key}.jsonl`,
      },
      events: Array.from({ length: events }, (_, i) => ({
        provider: 'codex',
        nativeSessionId: key,
        role: 'assistant' as const,
        text: 'x'.repeat(size),
        ordinal: i,
      })),
      withheld: 0,
      total: events,
    }
  }

  it('hands the remainder of a share to a section that still has events', () => {
    /**
     * The case the first-pass redistribution cannot reach. Every section here WANTS more than its
     * share, so nothing is handed over up front; the waste appears inside each section, which stops
     * at the first event too large for what is left of its allocation. Coarse events leave a
     * remainder each; the fine-grained section is the only one that can spend crumbs.
     */
    const coarse = [slice('codex:c1', 40, 900), slice('codex:c2', 40, 900)]
    const fine = slice('codex:fine', 400, 40)
    const result = compose([...coarse, fine], 12_000)

    const spent = result.usedChars
    expect(spent).toBeLessThanOrEqual(result.budgetChars)
    // Each coarse section leaves up to ~900 unspent; without the round-robin the answer lands near
    // three quarters of the budget, and the fine section never sees the difference.
    expect(spent).toBeGreaterThan(11_000)
  })

  it('never goes over, even when the headers cost more than their reserve', () => {
    // Wide titles and paths cost more than PER_SECTION_RESERVE estimates, which the under-spending
    // used to hide. The answer is measured and trimmed rather than trusted.
    const wide = (key: string) => ({
      ...slice(key, 50, 200),
      summary: {
        key,
        provider: 'codex',
        nativeSessionId: key,
        title: 't'.repeat(120),
        updatedAt: 1_000,
        sourcePath: `/tmp/${'p'.repeat(160)}`,
      },
    })

    for (const budget of [2_000, 3_000, 5_000]) {
      const result = compose([wide('codex:s1'), wide('codex:s2'), wide('codex:s3')], budget)

      expect(result.usedChars, `budget ${budget}`).toBeLessThanOrEqual(budget)
    }
  })

  it('reaches the ceiling by allocation, not by trimming back to it', () => {
    /**
     * The trim is a guarantee, not a plan: an answer that overshoots and is cut back does the work
     * twice and reports events as withheld that were rendered a moment earlier. With the fill
     * bounded by what the answer may cost, ordinary sections need no trim at all — which is what
     * this asserts, by counting withheld events against the events that were never taken.
     */
    const result = compose([slice('codex:s1', 60, 200), slice('codex:s2', 60, 200)], 12_000)
    const rendered = result.sections.reduce((sum, section) => sum + section.events.length, 0)

    expect(result.usedChars).toBeLessThanOrEqual(result.budgetChars)
    // 120 events exist; whatever was not rendered is exactly what is reported as withheld.
    expect(rendered + result.totalWithheldEvents).toBe(120)
  })

  it('counts every withheld event, including the ones the trim took back', () => {
    // The note used to be written before the trim, so it stated a number the answer then invalidated
    // by one per trimmed event — a disclosure wrong about the thing it discloses.
    // Wide headers force the trim to fire, which is the only way the two counts can diverge.
    const wideSlice = (key: string) => ({
      ...slice(key, 60, 300),
      summary: {
        key,
        provider: 'codex',
        nativeSessionId: key,
        // Wide enough that the header estimate is wrong and the trim actually fires — at 120/160 it
        // did not, and the case passed without exercising the ordering it was written for.
        title: 't'.repeat(400),
        updatedAt: 1_000,
        sourcePath: `/tmp/${'p'.repeat(400)}`,
      },
    })
    const result = compose([wideSlice('codex:s1'), wideSlice('codex:s2')], 2_000)
    const stated = /(\d[\d,]*) event\(s\) were withheld/.exec(result.text)?.[1]?.replace(/,/g, '')

    // The stated number and the accounting must agree — including the events of a section the trim
    // evicted whole, which is why this is checked where the trim actually fires.
    expect(Number(stated)).toBe(result.totalWithheldEvents)
    expect(result.totalWithheldEvents).toBeGreaterThanOrEqual(60)
  })
})

describe('the ceiling holds even when the headers alone break it', () => {
  /**
   * `PER_SECTION_RESERVE` bends the section count up front, and it is an ESTIMATE. Measured with a
   * 400-character title and a 400-character path: two sections cost 2,291 characters against a
   * 2,000 budget with every event already withheld — an answer over its own ceiling, with nothing
   * left to trim. The count bends again, now against the real cost.
   */
  function huge(key: string) {
    return {
      key,
      summary: {
        key,
        provider: 'codex',
        nativeSessionId: key,
        title: 't'.repeat(400),
        updatedAt: 1_000,
        sourcePath: `/tmp/${'p'.repeat(400)}`,
      },
      events: Array.from({ length: 60 }, (_, i) => ({
        provider: 'codex',
        nativeSessionId: key,
        role: 'assistant' as const,
        text: 'x'.repeat(200),
        ordinal: i,
      })),
      withheld: 0,
      total: 60,
    }
  }

  it('evicts a section rather than exceeding the budget', () => {
    const result = compose([huge('codex:s1'), huge('codex:s2')], 2_000)

    expect(result.usedChars).toBeLessThanOrEqual(2_000)
    expect(result.sections.length).toBe(1)
  })

  it('names the evicted session, the way an unaffordable one is named', () => {
    const result = compose([huge('codex:s1'), huge('codex:s2')], 2_000)

    // Leaving by a different door is not a reason to leave unannounced.
    expect(result.text).toContain('were not included at all')
    expect(result.notes.join(' ')).toContain('codex:s2')
  })

  it("still counts the evicted section's events as withheld", () => {
    const result = compose([huge('codex:s1'), huge('codex:s2')], 2_000)

    expect(result.totalWithheldEvents).toBeGreaterThanOrEqual(60)
  })

  it('keeps one section rather than emptying the answer', () => {
    /**
     * The floor, exercised for real. A 500 request is clamped UP to the 2,000 minimum, so a section
     * has to be unaffordable against THAT to reach the eviction branch at all — the first version of
     * this case asked for 500, got 2,000, fitted comfortably, and proved nothing.
     */
    const enormous = {
      ...huge('codex:only'),
      summary: {
        key: 'codex:only',
        provider: 'codex',
        nativeSessionId: 'codex:only',
        title: 't'.repeat(1_500),
        updatedAt: 1_000,
        sourcePath: `/tmp/${'p'.repeat(1_500)}`,
      },
    }
    const result = compose([enormous], 2_000)

    // Over its ceiling and kept: an empty answer teaches nothing about why it is empty.
    expect(result.sections.length).toBe(1)
    expect(result.usedChars).toBeGreaterThan(2_000)
  })
})

describe('a section that can afford nothing still shows something', () => {
  /**
   * A single event may cost up to MAX_EVENT_CHARS while a share is bodyBudget / sections, so a
   * section whose FIRST event is larger than its share renders nothing at all — and still pays for
   * its header. With a few sessions at a modest budget, a short session's section could show none
   * of its events across a wide range of budgets while a sizeable part of the budget went unspent;
   * with a foothold nearly all of it is used, and every section carries content.
   */
  function chunky(key: string, size: number, count = 6) {
    return {
      key,
      summary: {
        key,
        provider: 'codex',
        nativeSessionId: key,
        title: key,
        updatedAt: 1_000,
        sourcePath: `/tmp/${key}.jsonl`,
      },
      events: Array.from({ length: count }, (_, i) => ({
        provider: 'codex',
        nativeSessionId: key,
        role: 'assistant' as const,
        text: 'x'.repeat(size),
        ordinal: i,
      })),
      withheld: 0,
      total: count,
    }
  }

  it('renders a clipped first event rather than an empty section', () => {
    // Four sections share the body budget; a 3,800-character first event cannot fit any share.
    const result = compose(
      [
        chunky('codex:a', 3_800),
        chunky('codex:b', 3_800),
        chunky('codex:c', 3_800),
        chunky('codex:d', 3_800),
      ],
      12_000,
    )

    for (const section of result.sections) {
      expect(section.events.length, `${section.key} rendered nothing`).toBeGreaterThan(0)
    }
  })

  it('says the event is cut, since that is what the reader is looking at', () => {
    const result = compose([chunky('codex:a', 3_800), chunky('codex:b', 3_800)], 6_000)
    // The FOOTHOLD section, not the first one: the first fills normally and its event arrives
    // whole, which must not be marked as cut.
    const foothold = result.sections.find((section) => section.renderedChars < 3_800)

    expect(foothold?.events[0]?.text.endsWith('…')).toBe(true)
    expect(result.sections.every((section) => section.events.length > 0)).toBe(true)

    // And the converse, which is the half that can silently rot: an event that arrived WHOLE must
    // not carry the mark of a cut. A reader who sees an ellipsis goes looking for the rest.
    const whole = compose([chunky('codex:small', 120, 2)], 8_000)
    expect(whole.sections[0]?.events[0]?.text.endsWith('…')).toBe(false)
    expect(whole.sections[0]?.events[0]?.text).toBe('x'.repeat(120))
  })

  it('declines when the share cannot hold anything worth reading', () => {
    // Twelve sections against a small budget: a foothold of a few dozen characters would be a
    // header, an ellipsis and no content — more cost than it carries.
    const many = Array.from({ length: 12 }, (_, i) => chunky(`codex:s${i}`, 3_800))
    const result = compose(many, 4_000)

    expect(result.usedChars).toBeLessThanOrEqual(result.budgetChars)
  })

  it('leaves an empty session empty rather than inventing a foothold', () => {
    const empty = { ...chunky('codex:none', 100, 0) }
    const result = compose([empty, chunky('codex:a', 100)], 8_000)
    const section = result.sections.find((s) => s.key === 'codex:none')

    expect(section?.events).toHaveLength(0)
    expect(section?.withheldEvents).toBe(0)
  })
})
