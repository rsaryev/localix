import { describe, expect, test } from 'bun:test'
import { baseNameFromPath, matchDroppedPaths, parseDraggedPaths } from './droppedPathMatch'

describe('baseNameFromPath', () => {
  test('POSIX and Windows separators', () => {
    expect(baseNameFromPath('/Users/me/Downloads/notes.md')).toBe('notes.md')
    expect(baseNameFromPath('C:\\Users\\me\\notes.md')).toBe('notes.md')
    expect(baseNameFromPath('/Users/me/dir/')).toBe('dir')
    expect(baseNameFromPath('plain.txt')).toBe('plain.txt')
  })
})

describe('parseDraggedPaths', () => {
  test('parses well-formed entries and drops bad shapes', () => {
    expect(
      parseDraggedPaths([
        { path: '/a/b.txt', isDir: false },
        { path: '/a/dir', isDir: true },
        { path: '', isDir: false }, // empty path dropped
        { notPath: true }, // wrong shape dropped
        null,
      ]),
    ).toEqual([
      { path: '/a/b.txt', isDir: false },
      { path: '/a/dir', isDir: true },
    ])
  })

  test('non-array input → empty', () => {
    expect(parseDraggedPaths(undefined)).toEqual([])
    expect(parseDraggedPaths('nope')).toEqual([])
  })
})

describe('matchDroppedPaths', () => {
  const file = (p: string) => ({ path: p, isDir: false })

  test('exact single-file match', () => {
    expect(matchDroppedPaths(['b.txt'], [file('/a/b.txt')])).toEqual([file('/a/b.txt')])
  })

  test('multi-file match preserves dataTransfer order', () => {
    const entries = [file('/x/one.md'), file('/y/two.md')]
    expect(matchDroppedPaths(['two.md', 'one.md'], entries)).toEqual([
      file('/y/two.md'),
      file('/x/one.md'),
    ])
  })

  test('duplicate basenames pair positionally', () => {
    const entries = [file('/a/same.txt'), file('/b/same.txt')]
    expect(matchDroppedPaths(['same.txt', 'same.txt'], entries)).toEqual(entries)
  })

  test('count mismatch → null (stale pasteboard)', () => {
    expect(matchDroppedPaths(['b.txt'], [file('/a/b.txt'), file('/a/c.txt')])).toBeNull()
    expect(matchDroppedPaths(['b.txt', 'c.txt'], [file('/a/b.txt')])).toBeNull()
  })

  test('any unmatched name → null', () => {
    expect(matchDroppedPaths(['b.txt', 'zzz.txt'], [file('/a/b.txt'), file('/a/c.txt')])).toBeNull()
  })

  test('empty drop → null', () => {
    expect(matchDroppedPaths([], [])).toBeNull()
  })

  test('directories match like files', () => {
    const dir = { path: '/repo/my-project', isDir: true }
    expect(matchDroppedPaths(['my-project'], [dir])).toEqual([dir])
  })
})
