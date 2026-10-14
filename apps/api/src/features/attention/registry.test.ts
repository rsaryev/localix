import { describe, expect, test } from 'bun:test'

import type { AttentionItem } from './contracts'
import { createAttentionRegistry } from './registry'
import { planAttention, questionItem, restoreDurableAttention } from './sources'

const item = (key: string, at: string, sessionId = 'S1'): AttentionItem => ({
  key,
  kind: 'mention',
  sessionId,
  at,
  title: key,
  subject: {},
})

function harness() {
  const registry = createAttentionRegistry()
  const snapshots: string[][] = []
  const journal: string[] = []
  registry.onChange((_user, items) => snapshots.push(items.map((i) => i.key)))
  registry.observe({
    raised: (_user, raised) => journal.push(`raise ${raised.key}`),
    settled: (_user, target, reason) =>
      journal.push(`settle ${'key' in target ? target.key : `${target.prefix}*`} ${reason}`),
  })
  return { registry, snapshots, journal }
}

describe('the attention registry', () => {
  test('raise and settle move the snapshot (oldest first) and reach the journal once each', () => {
    const { registry, snapshots, journal } = harness()
    registry.raise('u', item('b', '2026-01-02'))
    registry.raise('u', item('a', '2026-01-01'))
    registry.settle('u', { key: 'b' }, 'answered')
    expect(snapshots).toEqual([['b'], ['a', 'b'], ['a']])
    expect(journal).toEqual(['raise b', 'raise a', 'settle b answered'])
    expect(registry.list('u').map((i) => i.key)).toEqual(['a'])
    expect(registry.list('other')).toEqual([])
  })

  test('a settle with nothing held still reaches the journal (a row from before a restart)', () => {
    const { registry, snapshots, journal } = harness()
    registry.settle('u', { prefix: 'mention:S1:' }, 'answered')
    expect(snapshots).toEqual([])
    expect(journal).toEqual(['settle mention:S1:* answered'])
  })

  test('a newer plan version supersedes the older by prefix, then raises', () => {
    const { registry, journal } = harness()
    const plans = planAttention(registry)
    const v = (n: number) =>
      ({
        id: `p${n}`,
        sessionId: 'R',
        version: n,
        title: `T${n}`,
        body: 'l1\nl2\nl3\nl4\nl5\nl6\nl7',
        createdAt: `2026-01-0${n}`,
      }) as never
    plans.awaiting('u', v(1), 'lead')
    plans.awaiting('u', v(2), 'lead')
    expect(registry.list('u').map((i) => i.key)).toEqual(['plan:R:p2'])
    expect(journal).toEqual([
      'settle plan:R:* superseded',
      'raise plan:R:p1',
      'settle plan:R:* superseded',
      'raise plan:R:p2',
    ])
    const [held] = registry.list('u')
    expect(held).toMatchObject({
      kind: 'plan',
      title: 'Plan v2: T2',
      subject: { planId: 'p2', version: 2, agentHandle: 'lead' },
    })
    // The excerpt is the opening lines, not the document.
    expect(held!.summary).toBe('l1\nl2\nl3\nl4\nl5\nl6')
  })

  test('a boot restore fills the snapshot without writing the journal again', () => {
    const { registry, snapshots, journal } = harness()
    restoreDurableAttention(registry, {
      questions: [
        {
          id: 'q',
          userId: 'u',
          sessionId: 'S1',
          agentId: 'a',
          displayId: 'q-1',
          toolCallId: 't',
          questions: [{ question: 'Which DB?' }] as never,
          status: 'pending',
          answers: null,
          askedAt: '2026-01-01',
          resolvedAt: null,
        },
      ],
      plans: [
        {
          id: 'p',
          userId: 'u',
          sessionId: 'R',
          version: 1,
          title: 'T',
          body: 'b',
          createdAt: '2026-01-02',
        } as never,
      ],
      planAuthors: new Map([['p', 'lead']]),
    })
    expect(snapshots).toEqual([['question:q', 'plan:R:p']])
    expect(journal).toEqual([])
    expect(registry.list('u')[1]?.subject.agentHandle).toBe('lead')
  })

  test('forgetting a session drops its items from the snapshot only', () => {
    const { registry, snapshots, journal } = harness()
    registry.raise('u', item('a', '1', 'S1'))
    registry.raise('u', item('b', '2', 'S2'))
    journal.length = 0
    registry.forgetSession('S1')
    expect(snapshots.at(-1)).toEqual(['b'])
    expect(journal).toEqual([])
  })

  test('a question item names the first question and how many more', () => {
    const built = questionItem({
      id: 'q',
      sessionId: 'S1',
      displayId: 'q-2',
      askedAt: 'x',
      questions: [{ question: 'One?' }, { question: 'Two?' }],
    } as never)
    expect(built).toMatchObject({ key: 'question:q', summary: 'One? (+1 more)' })
  })
})
