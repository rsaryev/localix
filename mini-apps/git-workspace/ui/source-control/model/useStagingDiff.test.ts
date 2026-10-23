import { describe, expect, test } from 'bun:test'
import type { FileDiffLines } from '../../../backend/source-control/contracts'
import { changeKeys, stagingDocument } from './useStagingDiff'
import { selectionKey } from './useSourceControlDiffs'

// Raw-diff indices start after the 4-line file header, as the backend reports them.
const DATA: FileDiffLines = {
  path: 'src/a.ts',
  mode: 'unstaged',
  diffId: 'abc',
  binary: false,
  lines: [
    { index: 4, kind: 'hunk', content: '@@ -1,4 +1,4 @@ fn' },
    { index: 5, kind: 'context', content: 'a', oldNo: 1, newNo: 1 },
    { index: 6, kind: 'del', content: 'b', oldNo: 2 },
    { index: 7, kind: 'add', content: 'B', newNo: 2 },
    { index: 8, kind: 'context', content: 'c', oldNo: 3, newNo: 3 },
    { index: 9, kind: 'del', content: 'd', oldNo: 4 },
    { index: 10, kind: 'hunk', content: '@@ -20 +20 @@' },
    { index: 11, kind: 'add', content: 'z', newNo: 20 },
  ],
}

describe('stagingDocument', () => {
  test('keeps each line keyed by its raw-diff index and the hunk header verbatim', () => {
    const doc = stagingDocument(DATA)
    expect(doc.hunks.map((h) => h.header)).toEqual(['@@ -1,4 +1,4 @@ fn', '@@ -20 +20 @@'])
    expect(doc.lines.map((l) => l.key)).toEqual([5, 6, 7, 8, 9, 11])
  })

  test('a change run is exactly the payload of its block op', () => {
    const doc = stagingDocument(DATA)
    const [first, second, third] = doc.runs
    expect(changeKeys(doc, first!.lineStart, first!.lineEnd)).toEqual([6, 7])
    expect(changeKeys(doc, second!.lineStart, second!.lineEnd)).toEqual([9])
    // Runs never span a hunk boundary: the next hunk's addition is its own block.
    expect(changeKeys(doc, third!.lineStart, third!.lineEnd)).toEqual([11])
    expect(changeKeys(doc)).toEqual([6, 7, 9, 11])
  })
})

test('a selection is keyed by repository AND path', () => {
  expect(selectionKey('/repo/a', 'package.json')).not.toBe(selectionKey('/repo/b', 'package.json'))
})
