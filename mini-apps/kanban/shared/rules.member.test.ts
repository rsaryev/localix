import { describe, expect, test } from 'bun:test'

import { leadsBoard, memberMay } from './rules'

const member = { agentId: 'a:qa', role: 'member' as const }
const own = { id: 'LX-1', agentId: 'a:qa', assignee: 'qa' }
const theirs = { id: 'LX-2', agentId: 'a:dev', assignee: 'dev' }

describe('memberMay', () => {
  test('a leader, a sole participant and a host with no role may do everything', () => {
    for (const speaker of [
      { agentId: 'a:qa', role: 'leader' as const },
      { agentId: 'a:qa', role: 'solo' as const },
      { agentId: 'a:qa' },
      undefined,
    ]) {
      expect(leadsBoard(speaker)).toBe(true)
      expect(memberMay('delete', theirs, speaker).ok).toBe(true)
      expect(memberMay('update', theirs, speaker, ['agent', 'status']).ok).toBe(true)
    }
  })

  test('a member works only its own cards, and is told whom to ask', () => {
    expect(memberMay('take', own, member).ok).toBe(true)
    const refused = memberMay('take', theirs, member)
    expect(refused).toEqual({
      ok: false,
      why: 'LX-2 belongs to @dev; ask the leader to reassign it.',
    })
    const unassigned = memberMay('detail', { id: 'LX-3', agentId: null, assignee: null }, member)
    expect(unassigned.ok).toBe(false)
  })

  test('a member never deletes or reorders, even its own card', () => {
    expect(memberMay('delete', own, member).ok).toBe(false)
    expect(memberMay('reorder', own, member).ok).toBe(false)
  })

  test('a member updates only items and priority', () => {
    expect(memberMay('update', own, member, ['task_id', 'items', 'priority']).ok).toBe(true)
    const refused = memberMay('update', own, member, ['task_id', 'agent', 'status'])
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.why).toContain('ask the leader to change agent, status')
  })

  test('list, search and create name no card and are allowed', () => {
    for (const action of ['list', 'search', 'create'])
      expect(memberMay(action, null, member).ok).toBe(true)
  })
})
