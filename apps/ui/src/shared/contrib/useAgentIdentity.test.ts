import { describe, expect, test } from 'bun:test'
import { agentAuthorId, resolveAuthorIdentity, agentProfileUri } from './useAgentIdentity'

test('a deleted author falls back to its id and never resolves through a replacement name', () => {
  const identity = resolveAuthorIdentity('deleted-id', [
    { record: { id: 'new-id', name: 'deleted-id' }, projectId: 'other' },
    { record: { id: 'another-id', name: 'old-name' }, projectId: 'other' },
  ])
  expect(identity).toEqual({
    agentId: 'deleted-id',
    name: 'deleted-id',
    scope: '',
  })
  expect(agentProfileUri(identity)).toBe('localix://ui/work-item/store?kind=agent&id=deleted-id')
  expect(
    resolveAuthorIdentity('new-id', [
      { record: { id: 'new-id', name: 'reviewer' }, projectId: 'p' },
    ]),
  ).toEqual({ agentId: 'new-id', name: 'reviewer', scope: 'p' })
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
    expect(agentAuthorId('agent:acme:reviewer')).toBe('acme:reviewer')
  })
})
