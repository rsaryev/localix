import { describe, expect, test } from 'bun:test'
import {
  agentAuthorId,
  humanizeHandle,
  resolveAuthorIdentity,
  agentProfileUri,
} from './useAgentIdentity'

test('deleted authors keep their snapshot and never resolve through a replacement handle', () => {
  const identity = resolveAuthorIdentity('deleted-id', { handle: 'old-name' }, [
    { record: { id: 'new-id', handle: 'deleted-id', label: 'Impostor' }, projectId: 'other' },
    { record: { id: 'another-id', handle: 'old-name', label: 'Replacement' }, projectId: 'other' },
  ])
  expect(identity).toEqual({
    agentId: 'deleted-id',
    handle: 'old-name',
    name: 'Old name',
    scope: '',
  })
  expect(agentProfileUri(identity)).toBe('localix://ui/work-item/store?kind=agent&id=deleted-id')
  expect(
    resolveAuthorIdentity('new-id', undefined, [
      { record: { id: 'new-id', handle: 'reviewer', label: 'Reviewer' }, projectId: 'p' },
    ]),
  ).toEqual({ agentId: 'new-id', handle: 'reviewer', name: 'Reviewer', scope: 'p' })
})

describe('agentAuthorId', () => {
  test('only an agent ref names an agent', () => {
    expect(agentAuthorId('agent:reviewer')).toBe('reviewer')
    // The human and the application author messages too, and neither gets a tile.
    expect(agentAuthorId('user')).toBeNull()
    expect(agentAuthorId('system')).toBeNull()
    expect(agentAuthorId(undefined)).toBeNull()
  })

  test('a bare prefix is not a handle', () => {
    expect(agentAuthorId('agent:')).toBeNull()
  })

  test('a handle may contain the separator', () => {
    expect(agentAuthorId('agent:team:reviewer')).toBe('team:reviewer')
  })
})

describe('humanizeHandle', () => {
  test.each([
    ['reviewer', 'Reviewer'],
    ['code-reviewer', 'Code reviewer'],
    ['code_reviewer', 'Code reviewer'],
    ['docs.writer', 'Docs writer'],
  ])('%s reads as %s', (handle, expected) => {
    expect(humanizeHandle(handle)).toBe(expected)
  })
})
