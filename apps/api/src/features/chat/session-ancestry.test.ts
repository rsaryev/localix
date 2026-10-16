import { describe, expect, test } from 'bun:test'
import { MAX_SESSION_ANCESTRY_DEPTH, resolveSessionRoot } from './session-ancestry'

type Node = { id: string; userId: string; parentSessionId: string | null; rootSessionId?: string }
const node = (id: string, parentSessionId: string | null, over: Partial<Node> = {}): Node => ({
  id,
  userId: 'owner',
  parentSessionId,
  ...over,
})

describe('resolveSessionRoot', () => {
  test('walks arbitrary depth and ignores conflicting denormalized root hints', () => {
    const root = node('root', null)
    const child = node('child', 'root', { rootSessionId: 'forged' })
    const grandchild = node('grandchild', 'child', { rootSessionId: 'other-user-root' })
    expect(resolveSessionRoot(grandchild, [root, child, grandchild])).toEqual({
      ok: true,
      root,
      depth: 2,
    })
  })

  test('top-level sessions resolve to themselves without any lookup collection', () => {
    const root = node('root', null)
    expect(resolveSessionRoot(root, [])).toEqual({ ok: true, root, depth: 0 })
  })

  test('fails closed and identifies a missing ancestor', () => {
    expect(resolveSessionRoot(node('child', 'gone'), [])).toEqual({
      ok: false,
      reason: 'missing-ancestor',
      sessionId: 'gone',
    })
  })

  test('detects self-cycles and multi-node cycles', () => {
    expect(resolveSessionRoot(node('self', 'self'), [])).toEqual({
      ok: false,
      reason: 'cycle',
      sessionId: 'self',
    })
    const a = node('a', 'b')
    const b = node('b', 'a')
    expect(resolveSessionRoot(a, [a, b])).toEqual({
      ok: false,
      reason: 'cycle',
      sessionId: 'a',
    })
  })

  test('rejects a mixed-owner ancestor even if its id matches the parent link', () => {
    const child = node('child', 'foreign')
    const foreign = node('foreign', null, { userId: 'intruder' })
    expect(resolveSessionRoot(child, [foreign])).toEqual({
      ok: false,
      reason: 'owner-mismatch',
      sessionId: 'foreign',
    })
  })

  test('bounds maliciously deep ancestry', () => {
    const chain = Array.from({ length: MAX_SESSION_ANCESTRY_DEPTH + 2 }, (_, index) =>
      node(`s${index}`, index === 0 ? null : `s${index - 1}`),
    )
    const start = chain.at(-1)!
    expect(resolveSessionRoot(start, chain)).toEqual({
      ok: false,
      reason: 'depth-exceeded',
      sessionId: 's0',
    })
  })
})
