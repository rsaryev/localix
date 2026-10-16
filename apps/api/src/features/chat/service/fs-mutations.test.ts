import { describe, expect, test } from 'bun:test'

import {
  assertNotIntoSelf,
  moveCmd,
  copyCmd,
  removeCmd,
  mkdirCmd,
  touchFileCmd,
  probeKindCmd,
  existsCmd,
  trashEntryName,
} from './fs-mutations'

/**
 * The containment RULE now lives in `lib/path-containment.ts` and is tested there; what
 * stays this module's to prove is the DECISION it makes with it — that the loop guard is
 * ROOT-INCLUSIVE. So these assert through the public `assertNotIntoSelf` rather than
 * through a private predicate, and they carry the three traps the old local copy carried:
 * the equal case, the sibling-prefix hole, and `.`/`..` normalization.
 */
describe('assertNotIntoSelf', () => {
  test('refuses a folder into ITSELF (the root-inclusive case — `cp -R /a/b /a/b`)', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a/b', true)).toThrow()
  })
  test('refuses a folder into its descendant', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a/b/c', true)).toThrow()
  })
  test('refuses a folder into a descendant spelled with . and ..', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a/b/./c/../c', true)).toThrow()
  })
  test('allows a folder into a sibling', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a/c', true)).not.toThrow()
  })
  test('allows a folder into a SIBLING-PREFIX dir (/a/bcd is not inside /a/b)', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a/bcd', true)).not.toThrow()
  })
  test('allows a folder into its own parent', () => {
    expect(() => assertNotIntoSelf('/a/b', '/a', true)).not.toThrow()
  })
  test('never refuses a file source', () => {
    expect(() => assertNotIntoSelf('/a/b.txt', '/a/b.txt', false)).not.toThrow()
  })
})

describe('command builders', () => {
  test('quote all path arguments', () => {
    expect(moveCmd("/it's", '/$(x)')).toBe("mv -- '/it'\\''s' '/$(x)'")
    expect(moveCmd('/a b', '/c')).toBe("mv -- '/a b' '/c'")
    expect(copyCmd('/a', '/b')).toBe("cp -R -- '/a' '/b'")
    expect(removeCmd('/a b')).toBe("rm -rf -- '/a b'")
    expect(mkdirCmd('/a b')).toBe("mkdir -p '/a b'")
    expect(touchFileCmd('/p', '/p/f')).toBe("mkdir -p '/p' && : > '/p/f'")
  })
  test('probe/exists emit stable sentinels', () => {
    expect(probeKindCmd('/a')).toContain('printf D')
    expect(existsCmd('/a')).toContain('__EXISTS__')
  })
})

describe('trashEntryName', () => {
  test('prefixes the timestamp', () => {
    expect(trashEntryName('note.txt', 1700000000000)).toBe('1700000000000-note.txt')
  })
  test('adds a salt segment when given', () => {
    expect(trashEntryName('note.txt', 1700000000000, 'xy9')).toBe('1700000000000-xy9-note.txt')
  })
})
