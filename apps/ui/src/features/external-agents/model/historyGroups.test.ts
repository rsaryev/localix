import { expect, test } from 'bun:test'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { externalHistoryGroups } from './historyGroups'

test('activity days own agent groups, rather than separate permanent agent rosters', () => {
  const now = new Date(2026, 9, 6, 12).getTime()
  const row = (key: string, provider: string, updatedAt: number): RosterRow => ({
    key,
    provider,
    nativeSessionId: key,
    title: key,
    updatedAt,
    sourcePath: '/fixture/history.jsonl',
    state: 'idle',
    authority: 'none',
  })
  const groups = externalHistoryGroups(
    [
      row('codex:today', 'codex', now),
      row('claude-code:today', 'claude-code', now),
      row('codex:yesterday', 'codex', now - 86_400_000),
    ],
    now,
  )
  expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday'])
  expect(groups[0]?.agents.map((agent) => agent.id)).toEqual(['codex', 'claude-code'])
  expect(groups[1]?.agents[0]?.sessions[0]?.key).toBe('codex:yesterday')
})
