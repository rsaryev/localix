import { expect, test } from 'bun:test'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { nativeHistoryRows } from './unifiedHistory'

const row = (key: string, cwd: string, overrides: Partial<RosterRow> = {}): RosterRow => ({
  key,
  cwd,
  provider: 'codex',
  nativeSessionId: key.slice(6),
  title: key,
  updatedAt: 1000,
  sourcePath: '/native/history',
  state: 'idle',
  authority: 'none',
  ...overrides,
})

test('merges only native sessions from the selected directory and its descendants', () => {
  const result = nativeHistoryRows(
    [
      row('codex:root', '/work/project'),
      row('codex:child', '/work/project/child'),
      row('codex:other', '/work/project-other'),
      row('codex:unknown', ''),
      row('codex:worker', '/work/project', { parentNativeSessionId: 'root' }),
    ],
    [],
    { id: 'project', workingDir: '/work/project/' },
  )
  expect(result.sessions.map((session) => session.externalAgentSessionKey)).toEqual([
    'codex:root',
    'codex:child',
  ])
  expect(result.sessions.every((session) => session.projectId === 'project')).toBe(true)
  expect(result.sources.size).toBe(2)
})

test('linked native sessions never reappear, including when our chat is archived', () => {
  const native = nativeHistoryRows([row('codex:known', '/work/project')], [], {
    id: 'project',
    workingDir: '/work/project',
  }).sessions[0]!
  const archived = { ...native, id: 'our-chat', isArchived: true }
  const result = nativeHistoryRows([row('codex:known', '/work/project')], [archived], {
    id: 'project',
    workingDir: '/work/project',
  })
  expect(result.sessions).toEqual([])
})

test('unresolved scope never becomes machine-wide native history', () => {
  expect(nativeHistoryRows([row('codex:native', '/work/project')], [], undefined).sessions).toEqual(
    [],
  )
})

test('a filesystem-root project includes its descendants', () => {
  const result = nativeHistoryRows([row('codex:native', '/work/project')], [], {
    id: 'root',
    workingDir: '/',
  })
  expect(result.sessions.map((session) => session.externalAgentSessionKey)).toEqual([
    'codex:native',
  ])
})

test('Default includes only its workspace tree and does not duplicate repeated native keys', () => {
  const source = row('codex:default', '/localix/workspace/chat')
  const result = nativeHistoryRows([source, source, row('codex:outside', '/work/project')], [], {
    id: 'default',
    workingDir: '/localix/workspace',
  })
  expect(result.sessions.map((session) => session.id)).toEqual(['native:codex:default'])
})
