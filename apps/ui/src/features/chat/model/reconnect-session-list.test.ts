import { describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import {
  mergeSessionListSummary,
  reconcileSessionListAfterReconnect,
} from './reconnect-session-list'

const session = (id: string, patch: Partial<UiSession> = {}): UiSession =>
  ({
    id,
    seq: 1,
    title: id,
    messages: [],
    isPinned: false,
    isArchived: false,
    createdAt: 1,
    updatedAt: 1,
    providerConnectionId: null,
    modelId: 'model-a',
    reasoningEffort: 'medium',
    pendingInteraction: null,
    pendingInteractionQueue: [],
    isRunning: false,
    projectId: null,
    parentSessionId: null,
    rootSessionId: null,
    sessionKind: 'chat',
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    sourceRuntime: null,
    pinnedSkills: [],
    sessionTiming: null,
    messageCount: 0,
    lspServers: [],
    lspDiagnostics: {},
    loops: [],
    queuedMessages: [],
    ...patch,
  }) as UiSession

describe('reconnect session-list reconciliation', () => {
  test('updates summary fields without wiping detail and live-only state', () => {
    const interaction = { request: { id: 'ask-2' } } as never
    const current = session('s1', {
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      pendingInteractionQueue: [interaction],
    })
    const summary = session('s1', {
      title: 'Fresh title',
      isRunning: true,
      runtimeStatus: 'running',
      queuedMessages: [{ id: 'q1' }] as never,
    })

    const merged = mergeSessionListSummary(current, summary)
    expect(merged).toMatchObject({
      title: 'Fresh title',
      isRunning: true,
      runtimeStatus: 'running',
      queuedMessages: [{ id: 'q1' }],
      pendingInteractionQueue: [interaction],
    })
    expect(merged.messages).toBe(current.messages)
  })

  test('removes rows confirmed absent by the authoritative response', () => {
    const keep = session('keep')
    const deletedElsewhere = session('deleted')
    const before = [keep, deletedElsewhere]

    expect(reconcileSessionListAfterReconnect(before, before, [session('keep')])).toEqual([
      expect.objectContaining({ id: 'keep' }),
    ])
  })

  test('preserves a row added or changed by the stream while REST was in flight', () => {
    const stable = session('stable')
    const changedBeforeResponse = { ...stable, isRunning: true, runtimeStatus: 'running' as const }
    const addedBeforeResponse = session('new-live', { isRunning: true })

    const result = reconcileSessionListAfterReconnect(
      [stable],
      [changedBeforeResponse, addedBeforeResponse],
      [session('stable', { isRunning: false, runtimeStatus: 'idle' })],
    )

    expect(result).toEqual([changedBeforeResponse, addedBeforeResponse])
  })
})
