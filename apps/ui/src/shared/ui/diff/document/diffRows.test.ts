import { describe, expect, test } from 'bun:test'
import { diffDocumentFromPatch } from './parsePatchText'
import { DIFF_ROW_HEIGHT, LARGE_FILE_LINES, layoutDiffRows, rowAt } from './diffRows'
import { diffStickyState } from './diffSticky'
import { createLineCache } from './lineCache'
import { LONG_LINE_COLS, RENDER_LINE_CHARS } from './diffDocument'

const file = (path: string, body: string[]) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${body.filter((l) => !l.startsWith('+')).length} +1,${body.filter((l) => !l.startsWith('-')).length} @@`,
    ...body,
  ].join('\n')

const TWO = `${file('a.ts', [' x', '-old', '+new'])}\n${file('b.ts', ['+only'])}`
const none = new Set<number>()

describe('layoutDiffRows', () => {
  test('unified: file header, hunk header, then one row per line', () => {
    const layout = layoutDiffRows(diffDocumentFromPatch(TWO), {
      split: false,
      fileHeaders: true,
      collapsed: none,
    })
    expect(layout.rows.map((r) => r.kind)).toEqual([
      'file',
      'hunk',
      'line',
      'line',
      'line',
      'file',
      'hunk',
      'line',
    ])
    expect(layout.fileRows).toEqual([0, 5])
    expect(layout.hunkRows).toEqual([1, 6])
    expect(layout.offsets[1]).toBe(DIFF_ROW_HEIGHT.file)
  })

  test('split: a modify pair shares one row, an unpaired add gets an empty left side', () => {
    const layout = layoutDiffRows(diffDocumentFromPatch(TWO), {
      split: true,
      fileHeaders: false,
      collapsed: none,
    })
    const pairs = layout.rows.filter((r) => r.kind === 'pair')
    expect(pairs).toEqual([
      { kind: 'pair', left: 0, right: 0 },
      { kind: 'pair', left: 1, right: 2 },
      { kind: 'pair', left: -1, right: 3 },
    ])
  })

  test('a collapsed large file keeps its header and says why it is hidden', () => {
    const big = file(
      'lock.json',
      Array.from({ length: LARGE_FILE_LINES + 1 }, (_, i) => `+${i}`),
    )
    const doc = diffDocumentFromPatch(`${big}\n${file('b.ts', ['+x'])}`)
    const layout = layoutDiffRows(doc, { split: false, fileHeaders: true, collapsed: new Set([0]) })
    expect(layout.rows.slice(0, 3)).toEqual([
      { kind: 'file', file: 0 },
      { kind: 'note', file: 0, note: 'large' },
      { kind: 'file', file: 1 },
    ])
  })

  test('row heights follow the root font scale', () => {
    const layout = layoutDiffRows(diffDocumentFromPatch(TWO), {
      split: false,
      fileHeaders: true,
      collapsed: none,
      scale: 16 / 14,
    })
    expect(layout.offsets[1]).toBe(Math.round(DIFF_ROW_HEIGHT.file * (16 / 14)))
    expect(rowAt(layout, layout.offsets[3]! + 1)).toBe(3)
  })
})

describe('diffStickyState', () => {
  const heights = { file: DIFF_ROW_HEIGHT.file, hunk: DIFF_ROW_HEIGHT.hunk }
  const layout = layoutDiffRows(diffDocumentFromPatch(TWO), {
    split: false,
    fileHeaders: true,
    collapsed: none,
  })

  test('nothing is pinned while the first header is still in flow', () => {
    expect(diffStickyState(layout, 0, heights, true)).toEqual({
      file: null,
      hunk: null,
      current: 0,
    })
  })

  test('scrolled into a file, its header and hunk pin; the next file pushes them up', () => {
    const inside = diffStickyState(layout, 30, heights, true)
    expect(inside.file).toEqual({ id: 0, shift: 0 })
    expect(inside.hunk?.id).toBe(0)
    // Row 5 (file b) starts at 28+24+60 = 112. At 100 its top is 12px under the pin.
    const pushed = diffStickyState(layout, 100, heights, true)
    expect(pushed.file).toEqual({ id: 0, shift: 112 - 100 - heights.file })
    expect(pushed.current).toBe(0)
    expect(diffStickyState(layout, 130, heights, true).current).toBe(1)
  })
})

describe('createLineCache', () => {
  test('computes a word-diff pair once, for both sides, and skips enormous lines', () => {
    const long = 'z'.repeat(LONG_LINE_COLS + 1)
    const doc = diffDocumentFromPatch(
      ['@@ -1,2 +1,2 @@', '-const a = 1', `-${long}`, '+const a = 2', `+${long}!`].join('\n'),
    )
    let calls = 0
    const cache = createLineCache(
      doc,
      () => 'ts',
      (text) => {
        calls++
        return text
      },
    )
    expect(cache.segments(0)?.some((s) => s.changed)).toBe(true)
    expect(cache.segments(2)?.some((s) => s.changed)).toBe(true)
    expect(cache.segments(1)).toBeNull()
    cache.html(0)
    cache.html(0)
    cache.html(1)
    expect(calls).toBe(1)
  })

  test('mounts at most RENDER_LINE_CHARS of a line and counts the rest', () => {
    const doc = diffDocumentFromPatch(`@@ -0,0 +1,1 @@\n+${'q'.repeat(RENDER_LINE_CHARS + 5)}`)
    const cache = createLineCache(
      doc,
      () => undefined,
      (t) => t,
    )
    expect(cache.html(0).length).toBe(RENDER_LINE_CHARS)
    expect(cache.hiddenChars(0)).toBe(5)
  })
})
