import { expect, test } from 'bun:test'
import type { AttentionItem } from '@localixai/api/client'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import { anyRunning, applyRunEvent, briefsFrom, islandRequests } from './requests'

const item = (key: string, kind: string, at: string) => ({ key, kind, at }) as AttentionItem

test('only a request that blocks a run reaches the island, oldest first', () => {
  const roster = [
    item('late', 'interaction', '2026-01-01T10:05:00Z'),
    item('plan', 'plan', '2026-01-01T10:00:00Z'),
    item('mention', 'mention', '2026-01-01T10:00:00Z'),
    item('early', 'interaction', '2026-01-01T10:01:00Z'),
  ]
  expect(islandRequests(roster, new Set()).map((entry) => entry.key)).toEqual(['early', 'late'])
})

test('a request answered here leaves the queue before the server roster agrees', () => {
  const roster = [item('a', 'interaction', '2026-01-01T10:00:00Z')]
  expect(islandRequests(roster, new Set(['a']))).toEqual([])
})

test('runs start and end per conversation, and a deleted conversation stops counting', () => {
  const started = { type: 'run.started' } as AgentStreamEvent
  const ended = { type: 'run.completed' } as AgentStreamEvent
  const on = applyRunEvent(new Map(), 's1', started)
  expect(anyRunning(on)).toBe(true)
  expect(applyRunEvent(on, 's1', started)).toBe(on)
  expect(applyRunEvent(on, 's2', ended)).toBe(on)
  expect(anyRunning(applyRunEvent(on, 's1', ended))).toBe(false)
  const deleted = { type: 'session.deleted', sessionIds: ['s1'] } as AgentStreamEvent
  expect(applyRunEvent(on, 'x', deleted).size).toBe(0)
})

test('the card can name the waiting conversation from the session list', () => {
  const briefs = briefsFrom([
    { id: 's1', title: 'Billing', projectId: 'p1', isRunning: true },
  ] as UiSession[])
  expect(briefs.get('s1')).toEqual({ title: 'Billing', projectId: 'p1', running: true })
  expect(anyRunning(briefs)).toBe(true)
})
