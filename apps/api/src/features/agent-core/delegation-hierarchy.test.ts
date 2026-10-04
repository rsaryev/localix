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
  test('narrows 3 → 2 → 1 → none as the tree deepens', () => {
    expect([0, 1, 2, 3, 4].map(fanoutAt)).toEqual([3, 2, 1, 0, 0])
    expect(delegatesAt(2)).toBe(true)
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
    if (!deep.ok) expect(deep.reason).toContain('delegation ends')
  })
})

describe('no cycles', () => {
  test('never to yourself', () => {
    const self = admitAssignees(root, [a], none)
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.reason).toContain('yourself')
  })

  test('b, delegated by a, may give c and d work — and never a', () => {
    const atB: DelegationPosition = { depth: 1, chain: ['a'], self: 'b', group }
    expect(admitAssignees(atB, [c, d], none)).toEqual({ ok: true })
    const up = admitAssignees(atB, [a], none)
    expect(up.ok).toBe(false)
    if (!up.ok) expect(up.reason).toContain('cannot take work back')
  })

  test('c, delegated by d, cannot delegate back to d — it addresses d directly', () => {
    const atC: DelegationPosition = { depth: 2, chain: ['a', 'd'], self: 'c', group }
    const back = admitAssignees(atC, [d], none)
    expect(back.ok).toBe(false)
    if (!back.ok) expect(back.reason).toContain('Address it directly')
    // b is not above c in THIS chain, so it can take the one task depth 2 allows.
    expect(admitAssignees(atC, [b], none)).toEqual({ ok: true })
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
