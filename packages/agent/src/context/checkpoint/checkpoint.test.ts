import { describe, expect, test } from 'bun:test'

import type { ChatMessage } from '../../chat'
import type { AgentItem } from '../../agents/items'
import { ELISION_MARKER } from '../op-menu'
import { estimateChatMessageTokens } from '../tokens'
import {
  planCheckpoint,
  projectCheckpoint,
  type CheckpointEntry,
  type ContextCheckpoint,
  type PlanCheckpointInput,
} from '.'

let seq = 0
const next = (prefix: string) => `${prefix}${++seq}`
const flags = { recoveryToolAvailable: true, recallToolAvailable: true }

function user(text: string, extra: Partial<CheckpointEntry> = {}): CheckpointEntry {
  return {
    message: { id: next('u'), role: 'user', content: text },
    turnStart: true,
    internal: false,
    pinned: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...extra,
  }
}

/** An assistant turn: thinking, a bash call with a long output, a read, and a long answer. */
function reply(k: number, options: { answerChars?: number } = {}): CheckpointEntry {
  const items: AgentItem[] = [
    { id: next('r'), type: 'reasoning', text: `thinking ${k}`, thinkingSignature: `sig-${k}` },
    {
      id: next('c'),
      type: 'command',
      toolCallId: next('call'),
      name: 'Bash',
      input: { command: `bun test step-${k}` },
      command: `bun test step-${k}`,
      exitCode: k % 3 === 0 ? 1 : 0,
      status: 'completed',
      resultText: `output ${k}\n`.repeat(400),
    },
    {
      id: next('t'),
      type: 'tool_call',
      toolCallId: next('call'),
      name: 'Read',
      activeVerb: 'Reading',
      input: { path: 'src/app.ts' },
      status: 'completed',
      resultText: `file body ${k}\n`.repeat(200),
    },
    {
      id: next('x'),
      type: 'text',
      text: `Answer ${k}. `.repeat((options.answerChars ?? 600) / 11),
    },
  ] as AgentItem[]
  return {
    message: { id: next('a'), role: 'assistant', content: '', items },
    turnStart: false,
    internal: false,
    pinned: false,
    createdAt: '2026-09-02T10:00:00.000Z',
  }
}

function conversation(turns: number): CheckpointEntry[] {
  const entries: CheckpointEntry[] = [user('the original task')]
  entries.push(reply(0))
  for (let k = 1; k < turns; k++) entries.push(user(`task ${k}`), reply(k))
  entries.push(user('what now?'))
  return entries
}

const tokens = (messages: readonly ChatMessage[]) =>
  messages.reduce((sum, message) => sum + estimateChatMessageTokens(message), 0)

const cardsMessage = (text: string): ChatMessage => ({ id: 'cards', role: 'user', content: text })

function plan(entries: CheckpointEntry[], extra: Partial<PlanCheckpointInput> = {}) {
  return planCheckpoint({
    entries,
    reason: 'threshold',
    targetTokens: Math.floor(tokens(entries.map((e) => e.message)) * 0.3),
    activeFromIndex: entries.length - 1,
    keepRecentCount: 4,
    keepRecentTokens: 4000,
    cardBudgetTokens: 2500,
    flags,
    ...extra,
  })
}

const project = (entries: CheckpointEntry[], checkpoint: ContextCheckpoint | undefined) =>
  projectCheckpoint(entries, checkpoint, { cardsMessage })

/** A target no amount of compression reaches: the plan has to evict whole turns. */
const tight = (entries: CheckpointEntry[]) => ({
  targetTokens: Math.floor(tokens(entries.map((e) => e.message)) * 0.06),
})

describe('planCheckpoint + projectCheckpoint', () => {
  test('masks observations and folds answers before it evicts a single turn', () => {
    const entries = conversation(30)
    const checkpoint = plan(entries, {
      targetTokens: Math.floor(tokens(entries.map((e) => e.message)) * 0.5),
    })
    const view = project(entries, checkpoint)

    expect(checkpoint.evictedThroughId).toBeUndefined()
    expect(checkpoint.tokens.after).toBeLessThanOrEqual(checkpoint.tokens.target)
    expect(tokens(view)).toBe(checkpoint.tokens.after)
    expect(view).toHaveLength(entries.length)
    expect(JSON.stringify(view[1])).toContain(ELISION_MARKER)
  })

  test('evicts the oldest turns into a card when compression cannot reach the target', () => {
    const entries = conversation(30)
    const checkpoint = plan(entries, tight(entries))
    const view = project(entries, checkpoint)

    expect(checkpoint.tokens.after).toBeLessThanOrEqual(checkpoint.tokens.target)
    expect(tokens(view)).toBe(checkpoint.tokens.after)
    expect(view[0]).toBe(entries[0]!.message)
    expect(view[view.length - 1]).toBe(entries[entries.length - 1]!.message)
    expect(checkpoint.evictedThroughId).toBeDefined()
    expect(view[1]!.content).toContain('Asked:')
    expect(view[1]!.content).toContain('task 1')
    expect(view[1]!.content).toContain('src/app.ts')
  })

  test('cuts only in front of a turn start', () => {
    const entries = conversation(30)
    const checkpoint = plan(entries, tight(entries))
    const cut = entries.findIndex((e) => e.message.id === checkpoint.evictedThroughId)
    expect(entries[cut + 1]!.turnStart).toBe(true)
  })

  test('the view only grows between checkpoints, even when a later read touches the same file', () => {
    for (const extra of [{}, tight(conversation(30))]) {
      const entries = conversation(30)
      const checkpoint = plan(entries, extra)
      const before = project(entries, checkpoint)
      const later = [...entries, reply(99), user('and then?')]
      const after = project(later, checkpoint)
      expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before))
    }
  })

  test('thinking is stripped up to the checkpoint and kept after it', () => {
    const entries = conversation(12)
    const checkpoint = plan(entries)
    const fresh = reply(100)
    const view = project([...entries, fresh], checkpoint)
    const covered = view.slice(0, -1)
    expect(covered.flatMap((m) => m.items ?? []).some((i) => i.type === 'reasoning')).toBe(false)
    expect(view[view.length - 1]!.items!.some((item) => item.type === 'reasoning')).toBe(true)
  })

  test('a later checkpoint never un-evicts and keeps the earlier cards', () => {
    const entries = conversation(30)
    const first = plan(entries, tight(entries))
    const longer = [...entries, reply(40), ...conversation(20).slice(1)]
    const second = plan(longer, { previous: first, ...tight(longer) })
    const index = (id: string | undefined) => longer.findIndex((e) => e.message.id === id)
    expect(index(second.evictedThroughId)).toBeGreaterThan(index(first.evictedThroughId))
    expect(second.cards[0]!.fromId).toBe(first.cards[0]!.fromId)
  })

  test('an evicted pinned message stays verbatim right after the cards', () => {
    const entries = conversation(30)
    entries[2] = { ...entries[2]!, pinned: true }
    entries[3] = { ...entries[3]!, pinned: true }
    const checkpoint = plan(entries, tight(entries))
    const view = project(entries, checkpoint)
    expect(checkpoint.pinnedIds).toEqual([entries[2]!.message.id, entries[3]!.message.id])
    expect(view[2]).toBe(entries[2]!.message)
    // A pinned answer keeps every word; only its thinking, bound to the old prefix, goes.
    expect(view[3]!.items).toEqual(entries[3]!.message.items!.filter((i) => i.type !== 'reasoning'))
  })

  test('a checkpoint that does not describe this branch is ignored', () => {
    const entries = conversation(30)
    const checkpoint = plan(entries, tight(entries))
    const otherBranch = entries.slice(0, 10)
    expect(project(otherBranch, checkpoint)).toEqual(otherBranch.map((e) => e.message))
  })

  test('folds a long answer to its head and tail before evicting its turn', () => {
    const entries = [user('the original task'), reply(1, { answerChars: 8000 }), user('ok?')]
    const checkpoint = plan(entries, {
      targetTokens: 1200,
      keepRecentCount: 1,
      keepRecentTokens: 50,
    })
    const view = project(entries, checkpoint)
    const answer = view[1]!.items!.find((item) => item.type === 'text')
    expect(checkpoint.evictedThroughId).toBeUndefined()
    expect(answer && 'text' in answer ? answer.text : '').toContain(ELISION_MARKER)
    expect(answer && 'text' in answer ? answer.text : '').toContain(
      `GlobalSearch(around_message_id="${entries[1]!.message.id}")`,
    )
  })
})
