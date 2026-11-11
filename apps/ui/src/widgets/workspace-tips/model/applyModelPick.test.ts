import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { applyModelPickToOpenChat } from './applyModelPick'

/** The few fields the draft check reads. */
const chat = (id: string, patch: Partial<UiSession> = {}): UiSession =>
  ({
    id,
    title: 'New Chat',
    sessionKind: 'chat',
    parentSessionId: null,
    isRunning: false,
    messages: [],
    messageCount: 0,
    isPinned: false,
    updatedAt: 0,
    projectId: null,
    ...patch,
  }) as UiSession

function state(activeSessionId: string | null, sessions: UiSession[]) {
  const calls: unknown[][] = []
  return {
    calls,
    activeSessionId,
    sessions,
    allSessions: sessions,
    setModelSelection: async (...args: unknown[]) => void calls.push(args),
  }
}

const pick = {
  providerConnectionId: 'or-new',
  modelId: 'openrouter/deepseek',
  reasoningEffort: 'low' as const,
}

describe('applyModelPickToOpenChat', () => {
  test('the untouched chat under setup starts on the pick', async () => {
    const s = state('draft', [chat('draft')])
    expect(await applyModelPickToOpenChat(s, pick)).toBe(true)
    expect(s.calls).toEqual([['draft', 'or-new', 'openrouter/deepseek', 'low']])
  })

  test('a chat that already holds messages keeps its model', async () => {
    const s = state('busy', [chat('busy', { messageCount: 3 })])
    expect(await applyModelPickToOpenChat(s, pick)).toBe(false)
    expect(s.calls).toEqual([])
  })

  test('with no chat open, only the project default changes', async () => {
    const s = state(null, [chat('draft')])
    expect(await applyModelPickToOpenChat(s, pick)).toBe(false)
    expect(s.calls).toEqual([])
  })

  test('a sub-agent or running chat is not a new chat', async () => {
    const worker = state('w', [chat('w', { parentSessionId: 'root' })])
    const running = state('r', [chat('r', { isRunning: true })])
    expect(await applyModelPickToOpenChat(worker, pick)).toBe(false)
    expect(await applyModelPickToOpenChat(running, pick)).toBe(false)
  })
})
