import { describe, expect, test } from 'bun:test'
import {
  collectTerminalLinks,
  detectFileLinks,
  detectUrls,
  filterTerminalLinks,
} from './terminalLinks'

describe('detectFileLinks', () => {
  test('path:line:col (tsc / eslint form)', () => {
    const [l] = detectFileLinks('src/foo.ts:42:10 - error TS2345: nope')
    expect(l).toMatchObject({ path: 'src/foo.ts', line: 42, column: 10 })
    expect(l.text).toBe('src/foo.ts:42:10')
    expect(l.startIndex).toBe(0)
    expect(l.endIndex).toBe('src/foo.ts:42:10'.length)
  })

  test('path:line without column', () => {
    const [l] = detectFileLinks('  at src/util/x.test.tsx:7')
    expect(l).toMatchObject({ path: 'src/util/x.test.tsx', line: 7, column: undefined })
  })

  test('absolute path with line:col', () => {
    const [l] = detectFileLinks('/Users/me/app/main.rs:120:3: warning')
    expect(l).toMatchObject({ path: '/Users/me/app/main.rs', line: 120, column: 3 })
  })

  test('paren form path(line,col)', () => {
    const [l] = detectFileLinks('build/Program.cs(88,17): error CS0103')
    expect(l).toMatchObject({ path: 'build/Program.cs', line: 88, column: 17 })
  })

  test('bracket form path[line,col]', () => {
    const [l] = detectFileLinks('foo/bar.ts[12,4] flagged')
    expect(l).toMatchObject({ path: 'foo/bar.ts', line: 12, column: 4 })
  })

  test('python traceback anchors the path, not the File prefix', () => {
    const line = '  File "app/models/user.py", line 33, in save'
    const [l] = detectFileLinks(line)
    expect(l).toMatchObject({ path: 'app/models/user.py', line: 33 })
    expect(line.slice(l.startIndex, l.endIndex)).toBe('app/models/user.py", line 33')
  })

  test('bare path with a separator (no line info) still links', () => {
    const [l] = detectFileLinks('wrote packages/agent/src/index.ts')
    expect(l).toMatchObject({ path: 'packages/agent/src/index.ts', line: undefined })
  })

  test('does not linkify prose words or bare dotted tokens', () => {
    expect(detectFileLinks('this is a plain sentence.')).toHaveLength(0)
    expect(detectFileLinks('version 1.2.3 released')).toHaveLength(0)
    expect(detectFileLinks('e.g. do the thing')).toHaveLength(0)
  })

  test('richer path:line beats a bare-path match at the same spot', () => {
    const matches = detectFileLinks('see src/a/b.ts:9 for details')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ path: 'src/a/b.ts', line: 9 })
  })

  test('multiple links on one line, sorted by position', () => {
    const matches = detectFileLinks('src/a.ts:1 and src/b.ts:2')
    expect(matches.map((m) => m.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(matches[0].startIndex).toBeLessThan(matches[1].startIndex)
  })

  test('./ and ../ relative roots', () => {
    expect(detectFileLinks('./scripts/run.ts:5')[0]).toMatchObject({
      path: './scripts/run.ts',
      line: 5,
    })
    expect(detectFileLinks('../lib/x.py:9:2')[0]).toMatchObject({
      path: '../lib/x.py',
      line: 9,
      column: 2,
    })
  })

  test('empty / oversized input is ignored', () => {
    expect(detectFileLinks('')).toHaveLength(0)
    expect(detectFileLinks('x'.repeat(3000))).toHaveLength(0)
  })

  // --- rooted extensionless final segment (directories / extensionless files) ---

  test('rooted path with an extensionless final segment (directory) links whole', () => {
    // Regression: the final segment used to require an extension, so this path
    // only linkified up to `.localix` (its last dotted segment).
    const [l] = detectFileLinks('/Users/dev/.localix/workspace/LOCALIX-795')
    expect(l).toMatchObject({ path: '/Users/dev/.localix/workspace/LOCALIX-795', line: undefined })
    expect(l.text).toBe('/Users/dev/.localix/workspace/LOCALIX-795')
    expect(l.endIndex).toBe('/Users/dev/.localix/workspace/LOCALIX-795'.length)
  })

  test('rooted extensionless path carries :line', () => {
    const [l] = detectFileLinks('/Users/dev/.localix/workspace/LOCALIX-795:42 failed')
    expect(l).toMatchObject({ path: '/Users/dev/.localix/workspace/LOCALIX-795', line: 42 })
  })

  test('~/ rooted extensionless path links whole', () => {
    expect(detectFileLinks('~/foo/bar')[0]).toMatchObject({ path: '~/foo/bar', line: undefined })
  })

  test('./ rooted extensionless path links whole', () => {
    expect(detectFileLinks('run cd ./scripts/build here')[0]).toMatchObject({
      path: './scripts/build',
    })
  })

  test('unrooted extensionless paths are NOT linkified (prose stays prose)', () => {
    expect(detectFileLinks('choose and/or maybe')).toHaveLength(0)
    expect(detectFileLinks('open 24/7 support')).toHaveLength(0)
    expect(detectFileLinks('foo/bar without extension')).toHaveLength(0)
  })

  test('a mid-word slash is not mistaken for a root', () => {
    // The `/` in `and/or` must not seed a bogus `/or` rooted match.
    expect(detectFileLinks('read/write access')).toHaveLength(0)
  })

  test('rooted path glued to = or ( still links', () => {
    expect(detectFileLinks('cmd --out=/tmp/build/out')[0]).toMatchObject({ path: '/tmp/build/out' })
    expect(detectFileLinks('(/Users/x/dir) note')[0]).toMatchObject({ path: '/Users/x/dir' })
  })

  test('trailing sentence punctuation is not part of a rooted path', () => {
    const [l] = detectFileLinks('cleaned /Users/x/dir. done')
    expect(l.path).toBe('/Users/x/dir')
    expect(l.text).toBe('/Users/x/dir')
  })

  // --- URLs stay whole; the file pattern must not bite into their innards ---

  test('a rooted path pattern does not bite into a URL', () => {
    // `//example.com/foo/bar.ts` inside an http URL used to match as a file.
    expect(detectFileLinks('open https://example.com/foo/bar.ts here')).toHaveLength(0)
    expect(detectFileLinks('see https://a.b/c/d/e, then')).toHaveLength(0)
  })

  test('a rooted path OUTSIDE a URL on the same line still links', () => {
    const matches = detectFileLinks('served https://host/x from /Users/me/app')
    expect(matches).toHaveLength(1)
    expect(matches[0].path).toBe('/Users/me/app')
  })
})

describe('detectUrls', () => {
  test('detects an http(s) URL', () => {
    const [u] = detectUrls('  Local:   http://localhost:5050/ ready')
    expect(u.url).toBe('http://localhost:5050/')
  })

  test('trims trailing sentence punctuation', () => {
    expect(detectUrls('see https://localix.ai/docs.')[0].url).toBe('https://localix.ai/docs')
    expect(detectUrls('(https://example.com/a)')[0].url).toBe('https://example.com/a')
  })

  test('offsets cover the trimmed url only', () => {
    const line = 'x https://a.b/c, y'
    const [u] = detectUrls(line)
    expect(line.slice(u.startIndex, u.endIndex)).toBe('https://a.b/c')
  })

  test('ignores non-http tokens', () => {
    expect(detectUrls('run npm install first')).toHaveLength(0)
  })
})

describe('collectTerminalLinks', () => {
  test('flattens file + url links across lines, most-recent first', () => {
    const lines = [
      'starting server at http://localhost:3000',
      'src/foo.ts:42:10 - error TS2345',
      'see docs at https://example.com/guide',
    ]
    const items = collectTerminalLinks(lines)
    expect(items[0]).toMatchObject({ kind: 'url', url: 'https://example.com/guide' })
    expect(items.some((i) => i.kind === 'file' && i.path === 'src/foo.ts' && i.line === 42)).toBe(
      true,
    )
    expect(items.some((i) => i.kind === 'url' && i.url === 'http://localhost:3000')).toBe(true)
  })

  test('dedupes a link repeated across lines', () => {
    const lines = ['src/a.ts:1:1 - error', 'noise', 'src/a.ts:1:1 - error again']
    const items = collectTerminalLinks(lines)
    expect(items.filter((i) => i.kind === 'file' && i.path === 'src/a.ts').length).toBe(1)
  })

  test('respects the max cap', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts:1:1`)
    expect(collectTerminalLinks(lines, 10)).toHaveLength(10)
  })

  test('skips blank lines and prose', () => {
    expect(collectTerminalLinks(['', 'just some words here', '   '])).toHaveLength(0)
  })
})

describe('filterTerminalLinks', () => {
  const items = collectTerminalLinks(['http://localhost:3000', 'src/foo.ts:42:10'])
  test('empty query returns all', () => {
    expect(filterTerminalLinks(items, '')).toHaveLength(items.length)
  })
  test('case-insensitive substring over label', () => {
    expect(filterTerminalLinks(items, 'FOO')).toHaveLength(1)
    expect(filterTerminalLinks(items, 'localhost')[0]).toMatchObject({ kind: 'url' })
  })
})
