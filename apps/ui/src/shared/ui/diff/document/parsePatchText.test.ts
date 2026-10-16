import { describe, expect, test } from 'bun:test'
import { diffDocumentFromPatch, parsePatchText } from './parsePatchText'

const TWO_FILES = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@ export function a() {',
  ' keep',
  '-old',
  '+new',
  ' tail',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  '',
].join('\n')

describe('parsePatchText', () => {
  test('sections a git patch per file and keeps the hunk function context', () => {
    const files = parsePatchText(TWO_FILES)
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'gone.txt'])
    expect(files[0]!.hunks[0]!.header).toBe('@@ -1,3 +1,3 @@ export function a() {')
    expect(files[1]!.deleted).toBe(true)
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['ctx', 3, 3],
    ])
  })

  test('a deleted line reading "-- x" is body, not the next file header', () => {
    // In the patch it is `--- x`; only the hunk counts tell it from a `---` header.
    const patch = ['--- a/f.md', '+++ b/f.md', '@@ -1,2 +1,1 @@', '--- x', ' y'].join('\n')
    const [file] = parsePatchText(patch)
    expect(file!.hunks[0]!.lines).toEqual([
      { type: 'del', text: '-- x', oldNo: 1 },
      { type: 'ctx', text: 'y', oldNo: 2, newNo: 1 },
    ])
  })

  test('a header-only change (binary, rename) is a file with no hunks', () => {
    const patch = [
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
    ].join('\n')
    const files = parsePatchText(patch)
    expect(files).toEqual([
      { path: 'logo.png', hunks: [], binary: true },
      { path: 'new.ts', hunks: [] },
    ])
  })

  test('a fragment with no @@ is typed line by line', () => {
    const [file] = parsePatchText('+added\n-removed\n context')
    expect(file!.hunks[0]!.header).toBe('')
    expect(file!.hunks[0]!.lines.map((l) => l.type)).toEqual(['add', 'del', 'ctx'])
  })

  test('the no-newline marker attaches to its hunk after the counts are spent', () => {
    const [file] = parsePatchText('@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file')
    expect(file!.hunks[0]!.lines.at(-1)).toEqual({
      type: 'meta',
      text: '\\ No newline at end of file',
    })
  })
})

describe('buildDiffDocument', () => {
  test('pairs a deletion run with the addition run after it and groups change runs', () => {
    const doc = diffDocumentFromPatch(
      ['@@ -1,4 +1,4 @@', ' a', '-b1', '-b2', '+B1', ' c', '+d'].join('\n'),
    )
    const [ctx, del1, del2, add1, ctx2, add2] = doc.lines
    expect(del1!.partner).toBe(3)
    expect(add1!.partner).toBe(1)
    expect(del2!.partner).toBe(-1)
    expect(add2!.partner).toBe(-1)
    expect([ctx!.run, del1!.run, del2!.run, add1!.run, ctx2!.run, add2!.run]).toEqual([
      -1, 0, 0, 0, -1, 1,
    ])
    expect(doc.runs).toEqual([
      { hunk: 0, lineStart: 1, lineEnd: 4 },
      { hunk: 0, lineStart: 5, lineEnd: 6 },
    ])
    expect(doc.files[0]).toMatchObject({ additions: 2, deletions: 2, firstLine: 2 })
  })

  test('counts display columns with tabs at four and records the widest line number', () => {
    const doc = diffDocumentFromPatch('@@ -120,1 +120,1 @@\n-\tx\n+yy')
    expect(doc.lines[0]!.cols).toBe(5)
    expect(doc.maxCols).toBe(5)
    expect(doc.maxLineNo).toBe(120)
  })
})
