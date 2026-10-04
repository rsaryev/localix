import { describe, expect, test } from 'bun:test'

import { buildSessionChain } from './session-tree'

type S = { id: string; parentSessionId?: string | null }
const ids = (chain: S[]) => chain.map((s) => s.id)

describe('buildSessionChain', () => {
  test('no active session → empty chain', () => {
    expect(buildSessionChain(null, [{ id: 'a' }])).toEqual([])
    expect(buildSessionChain(undefined, [])).toEqual([])
  })

  test('a root session (no parent) → just itself', () => {
    expect(ids(buildSessionChain({ id: 'a' }, [{ id: 'a' }]))).toEqual(['a'])
  })

  test('walks parents root-first', () => {
    const all: S[] = [
      { id: 'root' },
      { id: 'mid', parentSessionId: 'root' },
      { id: 'leaf', parentSessionId: 'mid' },
    ]
    expect(ids(buildSessionChain(all[2], all))).toEqual(['root', 'mid', 'leaf'])
  })

  test('a dangling parent ends the chain (parent not in the set)', () => {
    const leaf: S = { id: 'leaf', parentSessionId: 'ghost' }
    expect(ids(buildSessionChain(leaf, [leaf]))).toEqual(['leaf'])
  })

  test('a cycle is broken by the seen-guard (no infinite loop)', () => {
    const a: S = { id: 'a', parentSessionId: 'b' }
    const b: S = { id: 'b', parentSessionId: 'a' }
    const chain = buildSessionChain(a, [a, b])
    // a→b then b→a is already seen → stop. Chain holds each once, root-first.
    expect(ids(chain)).toEqual(['b', 'a'])
    expect(chain.length).toBe(2)
  })

  test('self-referential parent stops immediately', () => {
    const a: S = { id: 'a', parentSessionId: 'a' }
    expect(ids(buildSessionChain(a, [a]))).toEqual(['a'])
  })
})
