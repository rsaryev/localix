import { describe, expect, it } from 'bun:test'
import { annotateIntralineChanges, segmentLinePair } from './intralineDiff'
import { parseUnifiedDiff } from './parseUnifiedDiff'

describe('segmentLinePair', () => {
  it('marks only the changed words on each side', () => {
    const seg = segmentLinePair('const x = 1', 'const x = 2')
    expect(seg).not.toBeNull()
    const delChanged = seg!.del.filter((s) => s.changed).map((s) => s.text)
    const addChanged = seg!.add.filter((s) => s.changed).map((s) => s.text)
    expect(delChanged).toEqual(['1'])
    expect(addChanged).toEqual(['2'])
    // Reassembling each side reproduces the original text.
    expect(seg!.del.map((s) => s.text).join('')).toBe('const x = 1')
    expect(seg!.add.map((s) => s.text).join('')).toBe('const x = 2')
  })

  it('returns null for a whole-line rewrite (no shared content)', () => {
    expect(segmentLinePair('alpha beta', 'gamma delta')).toBeNull()
  })

  it('returns null when only whitespace is shared', () => {
    expect(segmentLinePair('  foo', '  bar')).toBeNull()
  })

  it('handles a shared prefix and suffix', () => {
    const seg = segmentLinePair('return foo(a, b)', 'return foo(a, c)')
    expect(seg).not.toBeNull()
    expect(
      seg!.add
        .filter((s) => s.changed)
        .map((s) => s.text)
        .join(''),
    ).toContain('c')
    expect(seg!.del.map((s) => s.text).join('')).toBe('return foo(a, b)')
  })
})

describe('annotateIntralineChanges', () => {
  it('pairs a single del line with the following add line', () => {
    const diff = ['@@ -1,3 +1,3 @@', ' context', '-const x = 1', '+const x = 2', ' trailing'].join(
      '\n',
    )
    const hunks = parseUnifiedDiff(diff)
    const ann = annotateIntralineChanges(hunks)
    // Layout: [ctx, del, add, ctx]
    expect(ann[0][0]).toBeNull() // context
    expect(ann[0][1]).not.toBeNull() // del
    expect(ann[0][2]).not.toBeNull() // add
    expect(ann[0][3]).toBeNull() // context
  })

  it('leaves pure additions (no paired deletion) unannotated', () => {
    const diff = ['@@ -1,1 +1,2 @@', ' keep', '+brand new line'].join('\n')
    const ann = annotateIntralineChanges(parseUnifiedDiff(diff))
    expect(ann[0].every((s) => s === null)).toBe(true)
  })

  it('pairs multiple del/add lines index by index', () => {
    const diff = ['@@ -1,2 +1,2 @@', '-let a = 1', '-let b = 2', '+let a = 10', '+let b = 20'].join(
      '\n',
    )
    const ann = annotateIntralineChanges(parseUnifiedDiff(diff))
    // [del a, del b, add a, add b] — all four annotated (each shares "let a"/"let b").
    expect(ann[0][0]).not.toBeNull()
    expect(ann[0][1]).not.toBeNull()
    expect(ann[0][2]).not.toBeNull()
    expect(ann[0][3]).not.toBeNull()
  })

  it('does not annotate an unbalanced whole-line replacement', () => {
    const diff = ['@@ -1,1 +1,1 @@', '-completely different old', '+totally other new text'].join(
      '\n',
    )
    const ann = annotateIntralineChanges(parseUnifiedDiff(diff))
    expect(ann[0].every((s) => s === null)).toBe(true)
  })
})
