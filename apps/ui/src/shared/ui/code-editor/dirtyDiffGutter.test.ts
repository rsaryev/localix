import { describe, expect, it } from 'bun:test'
import { mergeDirtyChanges, parseUnifiedDiff, type DirtyChange } from './dirtyDiffGutter'

/** git-style header lines that precede the first hunk (ignored by the parser). */
const HEADER = [
  'diff --git a/x.ts b/x.ts',
  'index 111..222 100644',
  '--- a/x.ts',
  '+++ b/x.ts',
].join('\n')

const withHeader = (...hunkLines: string[]) => [HEADER, ...hunkLines].join('\n')

describe('parseUnifiedDiff', () => {
  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('marks a pure addition run in modified coords', () => {
    const diff = withHeader('@@ -3,0 +4,2 @@', '+added one', '+added two', ' context')
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 4, toLine: 5, type: 'added' },
    ])
  })

  it('marks a modification (removed + added) at the added lines', () => {
    const diff = withHeader('@@ -10,2 +10,2 @@', ' before', '-old line', '+new line', ' after')
    // ' before' occupies line 10; the '-'/'+' run sits at line 11.
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 11, toLine: 11, type: 'modified' },
    ])
  })

  it('marks a pure deletion at the surviving line below the removal', () => {
    const diff = withHeader('@@ -5,3 +5,1 @@', ' keep', '-gone a', '-gone b', ' tail')
    // ' keep' is line 5; two lines removed; ' tail' survives at line 6, so the
    // wedge anchors to the line above it (line 5).
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 5, toLine: 5, type: 'deleted' },
    ])
  })

  it('anchors a deletion at the top of file to line 1', () => {
    const diff = withHeader('@@ -1,2 +1,1 @@', '-removed first', ' surviving')
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 1, toLine: 1, type: 'deleted' },
    ])
  })

  it('separates multiple runs and multiple hunks', () => {
    const diff = withHeader(
      '@@ -1,4 +1,5 @@',
      ' a',
      '+inserted',
      ' b',
      '-c',
      '+c2',
      ' d',
      '@@ -20,2 +21,1 @@',
      ' x',
      '-y',
    )
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 2, toLine: 2, type: 'added' }, // 'inserted' after 'a' (line 1)
      { fromLine: 4, toLine: 4, type: 'modified' }, // c→c2 after 'b' (line 3)
      { fromLine: 21, toLine: 21, type: 'deleted' }, // 'y' removed after 'x' (line 21)
    ])
  })

  it('ignores the "no newline at end of file" pseudo-line', () => {
    const diff = withHeader(
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    )
    expect(parseUnifiedDiff(diff)).toEqual<DirtyChange[]>([
      { fromLine: 1, toLine: 1, type: 'modified' },
    ])
  })
})

describe('mergeDirtyChanges', () => {
  it('returns nothing when neither side has changes', () => {
    expect(mergeDirtyChanges([], [])).toEqual([])
  })

  it('tags a line present only in the primary layer diff as primary layer', () => {
    expect(mergeDirtyChanges([{ fromLine: 3, toLine: 3, type: 'modified' }], [])).toEqual<
      DirtyChange[]
    >([{ fromLine: 3, toLine: 3, type: 'modified', layer: 'primary' }])
  })

  it('tags a line present only in the secondary layer diff as secondary layer', () => {
    expect(mergeDirtyChanges([], [{ fromLine: 7, toLine: 8, type: 'added' }])).toEqual<
      DirtyChange[]
    >([{ fromLine: 7, toLine: 8, type: 'added', layer: 'secondary' }])
  })

  it('tags a line present in BOTH diffs as both', () => {
    expect(
      mergeDirtyChanges(
        [{ fromLine: 5, toLine: 5, type: 'modified' }],
        [{ fromLine: 5, toLine: 5, type: 'modified' }],
      ),
    ).toEqual<DirtyChange[]>([{ fromLine: 5, toLine: 5, type: 'modified', layer: 'both' }])
  })

  it('splits a run into primary layer and secondary layer sub-runs at the boundary', () => {
    // Lines 10-12 primary layer, 12-13 secondary layer → 10-11 primary layer, 12 both, 13 secondary layer.
    const merged = mergeDirtyChanges(
      [{ fromLine: 10, toLine: 12, type: 'added' }],
      [{ fromLine: 12, toLine: 13, type: 'added' }],
    )
    expect(merged).toEqual<DirtyChange[]>([
      { fromLine: 10, toLine: 11, type: 'added', layer: 'primary' },
      { fromLine: 12, toLine: 12, type: 'added', layer: 'both' },
      { fromLine: 13, toLine: 13, type: 'added', layer: 'secondary' },
    ])
  })

  it('carries a pure deletion through with its stage, one anchor per wedge', () => {
    const merged = mergeDirtyChanges(
      [],
      [
        { fromLine: 4, toLine: 4, type: 'deleted' },
        { fromLine: 5, toLine: 5, type: 'deleted' },
      ],
    )
    // Adjacent deletions stay as separate single-line wedges (never coalesced).
    expect(merged).toEqual<DirtyChange[]>([
      { fromLine: 4, toLine: 4, type: 'deleted', layer: 'secondary' },
      { fromLine: 5, toLine: 5, type: 'deleted', layer: 'secondary' },
    ])
  })

  it('lets a real change supersede a deletion anchor on the same line', () => {
    const merged = mergeDirtyChanges(
      [{ fromLine: 6, toLine: 6, type: 'deleted' }],
      [{ fromLine: 6, toLine: 6, type: 'modified' }],
    )
    expect(merged).toEqual<DirtyChange[]>([
      { fromLine: 6, toLine: 6, type: 'modified', layer: 'both' },
    ])
  })
})
