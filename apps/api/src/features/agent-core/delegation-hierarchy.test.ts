import { describe, expect, test } from 'bun:test'

import {
  admitAssignees,
  delegatesAt,
  fanoutAt,
  type DelegationPosition,
} from './delegation-hierarchy'

const a = { agentId: 'a', handle: 'a' }
const b = { agentId: 'b', handle: 'b' }
const c = { agentId: 'c', handle: 'c' }
const d = { agentId: 'd', handle: 'd' }
const e = { agentId: 'e', handle: 'e' }

const group = ['a', 'b', 'c', 'd']
const root: DelegationPosition = { depth: 0, chain: [], self: 'a', group }
const none = new Set<string>()

describe('the delegation ladder', () => {
  test('permits three agents at the root and none in any child', () => {
    expect([0, 1, 2, 3, 4].map(fanoutAt)).toEqual([3, 0, 0, 0, 0])
    expect(delegatesAt(0)).toBe(true)
    expect(delegatesAt(1)).toBe(false)
    expect(delegatesAt(3)).toBe(false)
  })

  test('the lead hands one task to a team of three', () => {
    expect(admitAssignees(root, [b, c, d], none)).toEqual({ ok: true })
  })

  test('counts DIFFERENT agents across the session, not tasks', () => {
    // b already has work; a second task for b adds nobody new.
    expect(admitAssignees(root, [b], new Set(['b', 'c', 'd']))).toEqual({ ok: true })
    const over = admitAssignees({ ...root, group: null }, [e], new Set(['b', 'c', 'd']))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain('at most 3 different agents')
  })

  test('depth 3 delegates nothing', () => {
    const deep = admitAssignees({ depth: 3, chain: ['a', 'b', 'c'], self: 'd', group }, [b], none)
    expect(deep.ok).toBe(false)
    if (!deep.ok) expect(deep.reason).toContain('Only a root chat may delegate')
  })
})

describe('no cycles', () => {
  test('never to yourself', () => {
    const self = admitAssignees(root, [a], none)
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.reason).toContain('yourself')
  })

  test('children cannot send work up or down the former delegation chain', () => {
    for (const depth of [1, 2, 3]) {
      const child = { ...root, depth, chain: ['a'], self: 'b' }
      for (const target of [a, c]) {
        const decision = admitAssignees(child, [target], none)
        expect(decision.ok).toBe(false)
        if (!decision.ok) expect(decision.reason).toContain('Only a root chat')
      }
    }
  })
})

describe('the group', () => {
  test('in a conversation of several, only its participants take work', () => {
    const outside = admitAssignees(root, [e], none)
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.reason).toContain('not a participant')
  })

  test('a solo conversation delegates to any profile', () => {
    expect(admitAssignees({ ...root, group: null }, [e], none)).toEqual({ ok: true })
  })
})
