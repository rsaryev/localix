import { expect, test } from 'bun:test'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { externalHistoryGroups } from './historyGroups'
import { externalHistoryRows } from './historyRows'

const now = new Date(2026, 9, 6, 12).getTime()
const row = (key: string, title: string, updatedAt: number): RosterRow => ({
  key,
  provider: 'codex',
  nativeSessionId: key,
  title,
  updatedAt,
  sourcePath: '/history',
  state: 'idle',
  authority: 'none',
})
const groups = externalHistoryGroups(
  [
    row('codex:z', 'Zebra', now),
    row('codex:a', 'Alpha', now - 1000),
    row('codex:old', 'Before', now - 86400000),
  ],
  now,
)

test('activity grouping preserves date buckets and sorts titles within each agent', () => {
  const rows = externalHistoryRows(groups, new Set(), true, 'activity', 'title')
  expect(rows.filter((r) => r.kind === 'day').map((r) => r.id)).toEqual(['today', 'yesterday'])
  expect(rows.filter((r) => r.kind === 'session').map((r) => r.id)).toEqual([
    'codex:a',
    'codex:z',
    'codex:old',
  ])
  expect(rows.at(-1)?.kind).toBe('more')
})

test('agent grouping combines days, honours title/recent sorting and collapses a whole provider', () => {
  for (const [sortMode, expected] of [
    ['title', ['codex:a', 'codex:old', 'codex:z']],
    ['recent', ['codex:z', 'codex:a', 'codex:old']],
  ] as const) {
    const rows = externalHistoryRows(groups, new Set(), false, 'agent', sortMode)
    expect(rows.filter((r) => r.kind === 'day')).toEqual([])
    expect(rows.filter((r) => r.kind === 'session').map((r) => r.id)).toEqual([...expected])
    expect(rows[0]).toMatchObject({ kind: 'agent', provider: 'codex', count: 3 })
  }
  expect(externalHistoryRows(groups, new Set(['agent:codex']), false, 'agent', 'recent')).toEqual([
    { kind: 'agent', id: 'agent:codex', provider: 'codex', count: 3 },
  ])
})
