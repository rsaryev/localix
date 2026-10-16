import { afterEach, describe, expect, test } from 'bun:test'
import type { AttentionItem } from '@localixai/api/client'

import {
  attentionBySession,
  dialogAttentionItem,
  dockAttentionCount,
  topAttentionItem,
} from './select'
import {
  applyAttentionRoster,
  loadAttention,
  resetAttentionForTests,
  snoozeAttention,
  useAttentionStore,
} from './store'

const item = (over: Partial<AttentionItem> & Pick<AttentionItem, 'kind' | 'sessionId'>) =>
  ({
    key: `${over.kind}:${over.sessionId}:${over.at ?? 'x'}`,
    at: '2026-10-03T10:00:00.000Z',
    title: 'Waiting',
    subject: {},
    ...over,
  }) as AttentionItem

const none: ReadonlySet<string> = new Set()

afterEach(resetAttentionForTests)

describe('the one ranking every channel shares', () => {
  test('the dialog raises a blocked request over a plan over a mention, whatever their age', () => {
    const mention = item({ kind: 'mention', sessionId: 'a', at: '2026-10-03T12:00:00.000Z' })
    const plan = item({ kind: 'plan', sessionId: 'b', at: '2026-10-03T11:00:00.000Z' })
    const hitl = item({ kind: 'interaction', sessionId: 'c', at: '2026-10-03T09:00:00.000Z' })
    expect(dialogAttentionItem([mention, plan, hitl], null, none)).toBe(hitl)
    expect(dialogAttentionItem([mention, plan], null, none)).toBe(plan)
    expect(dialogAttentionItem([mention], null, none)).toBe(mention)
  })

  test('within a kind the newest wins', () => {
    const older = item({ kind: 'plan', sessionId: 'a', at: '2026-10-03T09:00:00.000Z' })
    const newer = item({ kind: 'plan', sessionId: 'b', at: '2026-10-03T11:00:00.000Z' })
    expect(dialogAttentionItem([older, newer], null, none)).toBe(newer)
  })

  test('never the chat on screen, never a snoozed item, never a kind that does not interrupt', () => {
    const here = item({ kind: 'interaction', sessionId: 'open' })
    const snoozed = item({ kind: 'plan', sessionId: 'b' })
    const question = item({ kind: 'question', sessionId: 'c' })
    const mention = item({ kind: 'mention', sessionId: 'd' })
    expect(
      dialogAttentionItem([here, snoozed, question, mention], 'open', new Set([snoozed.key])),
    ).toBe(mention)
    expect(dialogAttentionItem([here, question], 'open', none)).toBeNull()
  })

  test('the sidebar row shows its best item; questions rank below everything else', () => {
    const question = item({ kind: 'question', sessionId: 's', at: '2026-10-03T12:00:00.000Z' })
    const plan = item({ kind: 'plan', sessionId: 's', at: '2026-10-03T08:00:00.000Z' })
    const items = [question, plan]
    expect(topAttentionItem(items, 's')).toBe(plan)
    expect(attentionBySession(items).get('s')).toEqual([plan, question])
    // Memoized on the roster: every row reading it shares one grouping and stable arrays.
    expect(attentionBySession(items)).toBe(attentionBySession(items))
  })

  test('a kind this client does not know is ignored, not mis-ranked', () => {
    const future = item({ kind: 'from-the-future' as AttentionItem['kind'], sessionId: 's' })
    expect(topAttentionItem([future], 's')).toBeNull()
    expect(dialogAttentionItem([future], null, none)).toBeNull()
    expect(dockAttentionCount([future])).toBe(0)
  })

  test('the dock counts conversations, once each, and only kinds that count on it', () => {
    expect(
      dockAttentionCount([
        item({ kind: 'interaction', sessionId: 'a' }),
        item({ kind: 'mention', sessionId: 'a' }),
        item({ kind: 'plan', sessionId: 'b' }),
        item({ kind: 'question', sessionId: 'c' }),
      ]),
    ).toBe(2)
  })
})

describe('the mirrored roster', () => {
  test('snooze is per item key and pruned once the item leaves the roster', () => {
    const a = item({ kind: 'plan', sessionId: 'a' })
    const b = item({ kind: 'plan', sessionId: 'b' })
    applyAttentionRoster([a, b])
    snoozeAttention(a.key)
    expect(dialogAttentionItem([a, b], null, useAttentionStore.getState().snoozed)).toBe(b)
    applyAttentionRoster([b])
    expect(useAttentionStore.getState().snoozed.has(a.key)).toBe(false)
  })

  test('a fetch overtaken by a frame does not resurrect what the frame removed', async () => {
    const answered = item({ kind: 'interaction', sessionId: 'a' })
    let respond: (items: AttentionItem[]) => void = () => {}
    const loading = loadAttention(() => new Promise((resolve) => (respond = resolve)))
    applyAttentionRoster([])
    respond([answered])
    await loading
    expect(useAttentionStore.getState().items).toEqual([])
  })

  test('a fetch with nothing newer in flight applies, and a failed one keeps the roster', async () => {
    const plan = item({ kind: 'plan', sessionId: 'a' })
    await loadAttention(async () => [plan])
    expect(useAttentionStore.getState().items).toEqual([plan])
    await loadAttention(async () => {
      throw new Error('offline')
    })
    expect(useAttentionStore.getState().items).toEqual([plan])
  })
})
