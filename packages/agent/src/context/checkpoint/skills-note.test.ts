import { describe, expect, test } from 'bun:test'

import type { ChatMessage } from '../../chat'
import type { AgentItem } from '../../agents/items'
import { planCheckpoint, projectCheckpoint, type CheckpointEntry } from '.'

let seq = 0
const id = (prefix: string) => `${prefix}${++seq}`
const flags = { recoveryToolAvailable: true, recallToolAvailable: true }

const user = (text: string): CheckpointEntry => ({
  message: { id: id('u'), role: 'user', content: text },
  turnStart: true,
  internal: false,
  pinned: false,
})

/** An assistant turn that calls the Skill tool; a failed call carries the tool's error text. */
function skillTurn(call: {
  name?: string
  action?: string
  status: 'completed' | 'failed'
}): CheckpointEntry {
  const items = [
    {
      id: id('s'),
      type: 'tool_call',
      toolCallId: id('call'),
      name: 'Skill',
      activeVerb: 'Loading',
      input: { action: call.action ?? 'get', ...(call.name ? { name: call.name } : {}) },
      status: call.status,
      resultText: call.status === 'failed' ? 'Skill not found' : 'padding '.repeat(300),
    },
    { id: id('x'), type: 'text', text: 'done' },
  ] as AgentItem[]
  return {
    message: { id: id('a'), role: 'assistant', content: '', items },
    turnStart: false,
    internal: false,
    pinned: false,
  }
}

const cardsMessage = (text: string): ChatMessage => ({ id: 'cards', role: 'user', content: text })

function checkpointOf(turns: CheckpointEntry[]) {
  const entries = [user('task'), ...turns, user('what now?')]
  const record = planCheckpoint({
    entries,
    reason: 'threshold',
    targetTokens: 120,
    activeFromIndex: entries.length - 1,
    keepRecentCount: 1,
    keepRecentTokens: 50,
    cardBudgetTokens: 300,
    flags,
  })
  return { entries, record, view: projectCheckpoint(entries, record, { cardsMessage }) }
}

const textOf = (view: ChatMessage[]) =>
  view.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')

describe('skills loaded before a checkpoint', () => {
  test('the view after the checkpoint names a skill that loaded, once, and invites a reread', () => {
    const { view, record } = checkpointOf([
      skillTurn({ name: 'deploy', status: 'completed' }),
      user('next'),
      skillTurn({ name: '/deploy', status: 'completed' }),
      user('more'),
      skillTurn({ name: 'review', status: 'completed' }),
    ])
    expect(record.skills).toEqual(['deploy', 'review'])
    const text = textOf(view)
    expect(text).toContain('deploy, review')
    expect(text).toContain('Skill(action="get"')
  })

  test('a failed load is not named, and neither is a save', () => {
    const { view, record } = checkpointOf([
      skillTurn({ name: 'ghost', status: 'failed' }),
      user('next'),
      skillTurn({ name: 'notes', action: 'save', status: 'completed' }),
      user('more'),
      skillTurn({ name: 'real', status: 'completed' }),
    ])
    expect(record.skills).toEqual(['real'])
    expect(textOf(view)).not.toContain('ghost')
    expect(textOf(view)).not.toContain('notes')
  })

  test('no skills, no note', () => {
    const { view, record } = checkpointOf([skillTurn({ name: 'x', status: 'failed' })])
    expect(record.skills ?? []).toEqual([])
    expect(textOf(view)).not.toContain('Skill(')
  })

  test('the note is frozen with the record: later messages do not reword it', () => {
    const { entries, record } = checkpointOf([skillTurn({ name: 'deploy', status: 'completed' })])
    const later = [...entries, skillTurn({ name: 'zz-newer', status: 'completed' })]
    const before = textOf(projectCheckpoint(entries, record, { cardsMessage }))
    const after = textOf(projectCheckpoint(later, record, { cardsMessage }))
    expect(after).toContain(before)
    expect(after).not.toContain('zz-newer')
  })

  test('a skill loaded in the active turn is not called "earlier"', () => {
    const entries = [
      user('task'),
      skillTurn({ name: 'old', status: 'completed' }),
      user('next'),
      skillTurn({ name: 'filler', status: 'failed' }),
      user('active'),
      skillTurn({ name: 'fresh', status: 'completed' }),
    ]
    const record = planCheckpoint({
      entries,
      reason: 'threshold',
      targetTokens: 120,
      activeFromIndex: 4,
      keepRecentCount: 1,
      keepRecentTokens: 50,
      cardBudgetTokens: 300,
      flags,
    })
    expect(record.evictedThroughId).toBeDefined()
    expect(record.skills ?? []).not.toContain('fresh')
    expect(textOf(projectCheckpoint(entries, record, { cardsMessage }))).not.toContain('fresh,')
  })

  test('a checkpoint that evicted nothing adds no checkpoint message', () => {
    const entries = [user('task'), skillTurn({ name: 'deploy', status: 'completed' }), user('go')]
    const record = planCheckpoint({
      entries,
      reason: 'threshold',
      targetTokens: 100000,
      activeFromIndex: 2,
      keepRecentCount: 1,
      keepRecentTokens: 50,
      cardBudgetTokens: 300,
      flags,
    })
    expect(record.evictedThroughId).toBeUndefined()
    expect(textOf(projectCheckpoint(entries, record, { cardsMessage }))).not.toContain(
      'context-checkpoint',
    )
  })

  test('a later checkpoint keeps naming skills the previous one recorded', () => {
    const first = [
      user('task'),
      skillTurn({ name: 'old', status: 'completed' }),
      user('b'),
      skillTurn({ name: 'filler', status: 'failed' }),
      user('c'),
    ]
    const plan = (entries: CheckpointEntry[], previous?: ReturnType<typeof planCheckpoint>) =>
      planCheckpoint({
        entries,
        previous,
        reason: 'threshold',
        targetTokens: 120,
        activeFromIndex: entries.length - 1,
        keepRecentCount: 1,
        keepRecentTokens: 50,
        cardBudgetTokens: 300,
        flags,
      })
    const one = plan(first)
    expect(one.skills).toEqual(['old'])
    const more = [...first, skillTurn({ name: 'filler', status: 'failed' }), user('d')]
    const two = plan(more, one)
    expect(two.skills ?? []).toContain('old')
  })
})
