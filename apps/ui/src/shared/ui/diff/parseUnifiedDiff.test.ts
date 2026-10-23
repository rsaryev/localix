import { describe, expect, test } from 'bun:test'

import { firstChangedLine, languageFromPath, parseUnifiedDiff } from './parseUnifiedDiff'

const VALID_DIFF = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2new
+line2extra
 line3
`

describe('firstChangedLine', () => {
  test('returns the first added line number in the new file', () => {
    // hunk starts at new line 1: line1(1) ctx, then the additions land on line 2.
    expect(firstChangedLine(VALID_DIFF)).toBe(2)
  })

  test('falls back to the first context line for an all-deletion diff', () => {
    const delOnly = `--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,2 @@
 keep
-gone
 tail
`
    // No additions → first line carrying a new-file number is the leading context (line 1).
    expect(firstChangedLine(delOnly)).toBe(1)
  })

  test('returns undefined for empty/non-diff text', () => {
    expect(firstChangedLine('')).toBeUndefined()
  })
})

describe('parseUnifiedDiff — valid patch', () => {
  const hunks = parseUnifiedDiff(VALID_DIFF)

  test('produces one hunk with a reconstructed header', () => {
    expect(hunks).toHaveLength(1)
    expect(hunks[0].header).toBe('@@ -1,3 +1,4 @@')
  })

  test('types each line add/del/ctx and strips the marker', () => {
    expect(hunks[0].lines.map((l) => l.type)).toEqual(['ctx', 'del', 'add', 'add', 'ctx'])
    expect(hunks[0].lines.map((l) => l.text)).toEqual([
      'line1',
      'line2',
      'line2new',
      'line2extra',
      'line3',
    ])
  })

  test('advances old/new line numbers correctly (del only old, add only new, ctx both)', () => {
    const [ctx1, del, add1, add2, ctx2] = hunks[0].lines
    expect([ctx1.oldNo, ctx1.newNo]).toEqual([1, 1])
    expect([del.oldNo, del.newNo]).toEqual([2, undefined])
    expect([add1.oldNo, add1.newNo]).toEqual([undefined, 2])
    expect([add2.oldNo, add2.newNo]).toEqual([undefined, 3])
    expect([ctx2.oldNo, ctx2.newNo]).toEqual([3, 4])
  })
})

describe('parseUnifiedDiff — fallback for non-patch fragments', () => {
  test('naively types bare +/- lines under a single empty-header hunk', () => {
    const hunks = parseUnifiedDiff('+added\n-removed\ncontext')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].header).toBe('')
    expect(hunks[0].lines.map((l) => l.type)).toEqual(['add', 'del', 'ctx'])
    expect(hunks[0].lines.map((l) => l.text)).toEqual(['added', 'removed', 'context'])
  })

  test('numbers fallback lines sequentially so the gutter is not empty (V4A patch body)', () => {
    const hunks = parseUnifiedDiff('+added\n-removed\ncontext')
    expect(hunks[0].lines.map((l) => [l.oldNo, l.newNo])).toEqual([
      [undefined, 1], // add → new side only
      [1, undefined], // del → old side only
      [2, 2], // ctx → both
    ])
  })
})

describe('languageFromPath', () => {
  test('maps known extensions, case-insensitively', () => {
    expect(languageFromPath('src/x.ts')).toBe('typescript')
    expect(languageFromPath('a/b/Comp.TSX')).toBe('tsx')
    expect(languageFromPath('style.scss')).toBe('scss')
    expect(languageFromPath('main.py')).toBe('python')
  })
  test('maps C-family, Java, and Ruby files to loaded Monaco grammars', () => {
    expect(
      languageFromPath('/Users/dev/Documents/sample-project/native/win32/console-mode.c'),
    ).toBe('c')
    expect(languageFromPath('include/widget.h')).toBe('c')
    expect(languageFromPath('src/widget.cc')).toBe('cpp')
    expect(languageFromPath('include/widget.HPP')).toBe('cpp')
    expect(languageFromPath('src/Widget.java')).toBe('java')
    expect(languageFromPath('lib/widget.rb')).toBe('ruby')
  })
  test('shell + config extensions', () => {
    expect(languageFromPath('deploy.sh')).toBe('bash')
    expect(languageFromPath('.zshrc.zsh')).toBe('bash')
    expect(languageFromPath('config.yaml')).toBe('yaml')
    expect(languageFromPath('Cargo.toml')).toBe('toml')
  })
  test('Dockerfile by name (extension-less + variants)', () => {
    expect(languageFromPath('Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('docker/Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('Dockerfile.dev')).toBe('dockerfile')
    expect(languageFromPath('api.dockerfile')).toBe('dockerfile')
  })
  test('unknown extension or no path → text', () => {
    expect(languageFromPath('file.xyz')).toBe('text')
    expect(languageFromPath('noext')).toBe('text')
    expect(languageFromPath(undefined)).toBe('text')
  })
})
