import { describe, expect, test } from 'bun:test'
import type { AttentionItem } from '@localixai/api/client'
import { toUiSessionSummary } from '@/shared/api/converters'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import {
  applyCompanionEvent,
  companionRoster,
  islandRequests,
  nextRequest,
  pendingRequest,
} from './roster'

const session = (id: string, updatedAt: number, patch: Partial<UiSession> = {}): UiSession =>
  ({ id, title: id, updatedAt, isRunning: false, isArchived: false, ...patch }) as UiSession

const request = (key: string, sessionId: string, kind: AttentionItem['kind']): AttentionItem => ({
  key,
  sessionId,
  kind,
  title: key,
  at: '2026-10-10T10:00:00Z',
  subject: {},
})

describe('companion roster', () => {
  test('sorts the numeric dates produced by the real session converter without crashing', () => {
    const wire = (id: string, updatedAt: string) =>
      ({
        id,
        title: id,
        createdAt: updatedAt,
        updatedAt,
        revision: 1,
        agents: [],
        isPinned: false,
        isArchived: false,
        isRunning: false,
        sessionKind: 'chat',
        runtimeStatus: 'idle',
        pinnedSkills: [],
      }) as unknown as Parameters<typeof toUiSessionSummary>[0]
    const older = toUiSessionSummary(wire('older', '2026-10-09T10:00:00Z'))
    const newer = toUiSessionSummary(wire('newer', '2026-10-10T10:00:00Z'))
    expect(typeof newer.updatedAt).toBe('number')
    expect(companionRoster([older, newer], []).recent.map((entry) => entry.id)).toEqual([
      'newer',
      'older',
    ])
    expect(
      companionRoster(
        [
          { ...older, isRunning: true },
          { ...newer, isRunning: true },
        ],
        [],
      ).working.map((entry) => entry.id),
    ).toEqual(['newer', 'older'])
  })

  test('keeps every pending request, including multiple requests for the same conversation', () => {
    const first = request('approval-1', 'busy', 'interaction')
    const second = request('approval-2', 'busy', 'interaction')
    const question = request('question', 'other', 'mention')
    const result = companionRoster(
      [session('busy', 20, { isRunning: true }), session('other', 10)],
      [question, first, second],
    )
    expect(result.waiting).toEqual([first, second, question])
    expect(result.working).toEqual([])
    expect(result.recent).toEqual([])
  })

  test('bounds recent conversations and hides archived history while retaining active work', () => {
    const result = companionRoster(
      [
        ...Array.from({ length: 6 }, (_, index) => session(`recent-${index}`, index)),
        session('archive', 100, { isArchived: true }),
        session('working', 90, { isRunning: true }),
      ],
      [],
    )
    expect(result.recent.map((entry) => entry.id)).toEqual([
      'recent-5',
      'recent-4',
      'recent-3',
      'recent-2',
    ])
    expect(result.working.map((entry) => entry.id)).toEqual(['working'])
  })

  test('run completion and session deletion remove obsolete working rows', () => {
    const before = [session('busy', 10, { isRunning: true }), session('idle', 5)]
    const ended = applyCompanionEvent(before, 'busy', { type: 'run.completed' } as AgentStreamEvent)
    expect(companionRoster(ended, []).working).toEqual([])
    const deleted = applyCompanionEvent(before, 'busy', {
      type: 'session.deleted',
      sessionIds: ['busy'],
    } as AgentStreamEvent)
    expect(deleted.map((entry) => entry.id)).toEqual(['idle'])
    expect(before[0]?.isRunning).toBe(true)
  })
})

describe('island requests', () => {
  const approval = request('approval', 'a', 'interaction')
  const question = request('question', 'quick', 'interaction')
  const plan = request('plan', 'b', 'plan')
  const requests = islandRequests([approval, plan, question])

  test('answers inline only interactions, in roster order', () => {
    expect(requests.map((item) => item.key)).toEqual(['approval', 'question'])
  })

  test('prefers the selection, then the quick conversation, then the oldest request', () => {
    expect(pendingRequest(requests, 'approval', 'quick')?.key).toBe('approval')
    expect(pendingRequest(requests, null, 'quick')?.key).toBe('question')
    expect(pendingRequest(requests, 'gone', undefined)?.key).toBe('approval')
    expect(pendingRequest([], null, 'quick')).toBeUndefined()
  })

  test('next cycles and restarts when the current request was resolved', () => {
    expect(nextRequest(requests, 'approval')?.key).toBe('question')
    expect(nextRequest(requests, 'question')?.key).toBe('approval')
    expect(nextRequest(requests, 'resolved-elsewhere')?.key).toBe('approval')
  })
})
