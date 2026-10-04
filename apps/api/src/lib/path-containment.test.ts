import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { isPathBelow, isPathWithin, resolveWithin } from './path-containment'

describe('isPathWithin', () => {
  test('the root itself is within itself', () => {
    expect(isPathWithin('/a/root', '/a/root')).toBe(true)
    // …and so is a non-normalized spelling of it.
    expect(isPathWithin('/a/root', '/a/root/')).toBe(true)
    expect(isPathWithin('/a/root', '/a/root/sub/..')).toBe(true)
  })

  test('a descendant is within', () => {
    expect(isPathWithin('/a/root', '/a/root/x')).toBe(true)
    expect(isPathWithin('/a/root', '/a/root/x/y/z.ts')).toBe(true)
  })

  test('SIBLING-PREFIX attack: a sibling whose name starts with the root is NOT within', () => {
    // The trap a bare `candidate.startsWith(root)` walks into.
    expect(isPathWithin('/a/root', '/a/rootExtra')).toBe(false)
    expect(isPathWithin('/a/root', '/a/root-evil/secrets')).toBe(false)
  })

  test('`..` traversal out of the root is NOT within', () => {
    expect(isPathWithin('/a/root', '/a/root/../../etc/passwd')).toBe(false)
    expect(isPathWithin('/a/root', '/a')).toBe(false)
    expect(isPathWithin('/a/root', '/')).toBe(false)
  })

  test('a directory literally NAMED `..x` is within (it is not traversal)', () => {
    expect(isPathWithin('/a/root', '/a/root/..x')).toBe(true)
  })
})

describe('isPathBelow', () => {
  test('the root itself is NOT below itself', () => {
    expect(isPathBelow('/a/root', '/a/root')).toBe(false)
    expect(isPathBelow('/a/root', '/a/root/')).toBe(false)
  })

  test('a descendant is below', () => {
    expect(isPathBelow('/a/root', '/a/root/x')).toBe(true)
  })

  test('an escape is not below', () => {
    expect(isPathBelow('/a/root', '/a/rootExtra')).toBe(false)
    expect(isPathBelow('/a/root', '/a/root/../out')).toBe(false)
  })
})

describe('resolveWithin', () => {
  // resolveWithin returns a branded ContainedPath; these assert its string VALUE, so the
  // result is widened to the base type the runtime comparison actually uses.
  const within = (root: string, target: string): string | null => resolveWithin(root, target)

  test('resolves a relative target against the root', () => {
    expect(within('/a/root', 'sub/file.ts')).toBe(path.resolve('/a/root/sub/file.ts'))
    expect(within('/a/root', '.')).toBe(path.resolve('/a/root'))
  })

  test('an ABSOLUTE target is checked, not honoured blindly', () => {
    expect(within('/a/root', '/etc/passwd')).toBeNull()
    expect(within('/a/root', '/a/root/ok.ts')).toBe(path.resolve('/a/root/ok.ts'))
  })

  test('`..` traversal returns null', () => {
    expect(resolveWithin('/a/root', '../escape')).toBeNull()
    expect(resolveWithin('/a/root', 'sub/../../escape')).toBeNull()
  })

  test('a sibling-prefix target returns null', () => {
    expect(resolveWithin('/a/root', '../rootExtra/x')).toBeNull()
  })
})
