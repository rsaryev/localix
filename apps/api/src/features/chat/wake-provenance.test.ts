import { describe, expect, test } from 'bun:test'
import type { WakeSource } from './contracts'
import {
  deriveWakeProvenance,
  isWakeSource,
  wakeSourceLabel,
  WAKE_SOURCE_LABEL,
  type WakeRow,
} from './wake-provenance'

let seq = 0
const row = (props: Partial<WakeRow> & Pick<WakeRow, 'role'>): WakeRow => ({
  id: `m${++seq}`,
  ...props,
})

/** The hidden wake row a loop/job/monitor turn is persisted as. */
const wake = (wakeSource: WakeSource): WakeRow =>
  row({ role: 'user', isInternal: true, wakeSource })

describe('deriveWakeProvenance', () => {
  test('lifts a hidden wake row onto the assistant turn it explains', () => {
    const [hidden, reply] = [wake('loop'), row({ role: 'assistant' })]
    expect(deriveWakeProvenance([hidden, reply])).toEqual(new Map([[reply.id, 'loop']]))
  })

  test('a system notice between the wake row and the reply does NOT swallow the tag', () => {
    // The drift that lost the web's "via Loop" chip: a system/uiOnly row consumed the
    // pending tag, and its render branch takes no wake source — so the tag vanished.
    const [hidden, notice, reply] = [
      wake('bg-monitor'),
      row({ role: 'system' }),
      row({ role: 'assistant' }),
    ]
    const map = deriveWakeProvenance([hidden, notice, reply])
    expect(map.get(reply.id)).toBe('bg-monitor')
    expect(map.has(notice.id)).toBe(false)
  })

  test('a further hidden row does not consume the pending tag either', () => {
    const [hidden, alsoHidden, reply] = [
      wake('bg-job'),
      row({ role: 'user', isInternal: true }),
      row({ role: 'assistant' }),
    ]
    expect(deriveWakeProvenance([hidden, alsoHidden, reply]).get(reply.id)).toBe('bg-job')
  })

  test('user-busy is a real queued user message, not provenance for what follows', () => {
    const [queued, reply] = [wake('user-busy'), row({ role: 'assistant' })]
    expect(deriveWakeProvenance([queued, reply]).size).toBe(0)
  })

  test('user-steer is VISIBLE and badges itself — it was injected into the run above', () => {
    const steer = row({ role: 'user', wakeSource: 'user-steer' })
    expect(deriveWakeProvenance([steer]).get(steer.id)).toBe('user-steer')
  })

  test('a tag is consumed once — a second assistant turn is not also badged', () => {
    const [hidden, first, second] = [
      wake('bg-job'),
      row({ role: 'assistant' }),
      row({ role: 'assistant' }),
    ]
    const map = deriveWakeProvenance([hidden, first, second])
    expect(map.get(first.id)).toBe('bg-job')
    expect(map.has(second.id)).toBe(false)
  })

  test('degenerate input: empty, source-less and dangling rows yield no provenance, not a throw', () => {
    expect(deriveWakeProvenance([]).size).toBe(0)
    // A hidden row with NO source cannot explain anything.
    expect(
      deriveWakeProvenance([row({ role: 'user', isInternal: true }), row({ role: 'assistant' })])
        .size,
    ).toBe(0)
    // A wake row with no assistant after it: the tag is simply never consumed.
    expect(deriveWakeProvenance([wake('hook')]).size).toBe(0)
  })

  test('unknown persisted origins stay inert for mixed-version clients', () => {
    const hidden = row({ role: 'user', isInternal: true, wakeSource: 'retired_source' })
    const reply = row({ role: 'assistant' })
    expect(deriveWakeProvenance([hidden, reply])).toEqual(new Map())
    expect(isWakeSource('retired_source')).toBe(false)
    expect(wakeSourceLabel('retired_source')).toBeUndefined()
  })
})

describe('WAKE_SOURCE_LABEL', () => {
  test('names every WakeSource — a new source cannot land unlabelled', () => {
    // The Record<WakeSource, string> type is the real guard (a missing key is a type
    // error); this pins that no entry is blank, which the type cannot see.
    for (const [source, label] of Object.entries(WAKE_SOURCE_LABEL)) {
      expect(label, `${source} has no label`).not.toBe('')
    }
  })

  test('a plan decision explains the turn it opened', () => {
    // The person's approval (or review) is what started the implementation turn; its chip must
    // say so rather than read as the agent acting unprompted.
    const map = deriveWakeProvenance([
      { id: 'w', role: 'user', isInternal: true, wakeSource: 'plan-approved' },
      { id: 'a', role: 'assistant' },
    ])
    expect(map.get('a')).toBe('plan-approved')
    expect(wakeSourceLabel('plan-approved')).toBe('Plan approval')
    expect(wakeSourceLabel('plan-review')).toBe('Plan review')
  })

  test('the compact lowercase tag is derivable from the canonical label', () => {
    // The compact dim "via loop" tag — the reason the cased form is the one owned.
    expect(WAKE_SOURCE_LABEL.loop.toLowerCase()).toBe('loop')
    expect(WAKE_SOURCE_LABEL.subagent.toLowerCase()).toBe('sub-agent')
    expect(WAKE_SOURCE_LABEL['bg-monitor'].toLowerCase()).toBe('monitor')
  })
})
