import { describe, expect, it } from 'bun:test'
import {
  createNextEditCache,
  narrowTypedThroughSuggestion,
  nextEditCacheKeyFromDigest,
  nextEditDocumentDigest,
  rotateHunks,
  shiftEditsAfterApply,
  survivingEditsAfterApply,
} from './nextEditPrediction'
import { isSuggestionDrifted } from './suggestionDecorations'
import type { EditorSuggestion } from './types'

const hunk = (
  over: Partial<EditorSuggestion> & Pick<EditorSuggestion, 'startLine' | 'endLine'>,
): EditorSuggestion => ({
  id: `h:${over.startLine}`,
  kind: 'suggestion',
  original: 'orig',
  replacement: 'repl',
  ...over,
})

describe('survivingEditsAfterApply', () => {
  it('drops a shifted hunk whose anchor no longer matches the live document', () => {
    const applied = hunk({ startLine: 1, endLine: 1, original: 'a', replacement: 'A\nA2' })
    const rest = [hunk({ startLine: 3, endLine: 3, original: 'c', replacement: 'C' })]
    expect(survivingEditsAfterApply(rest, applied, 'A\nA2\nb\nchanged')).toEqual([])
  })

  it('keeps a shifted hunk with a valid post-apply anchor', () => {
    const applied = hunk({ startLine: 1, endLine: 1, original: 'a', replacement: 'A\nA2' })
    const rest = [hunk({ startLine: 3, endLine: 3, original: 'c', replacement: 'C' })]
    expect(survivingEditsAfterApply(rest, applied, 'A\nA2\nb\nc')).toMatchObject([
      { startLine: 4, endLine: 4 },
    ])
  })
})

describe('nextEditDocumentDigest', () => {
  it('is deterministic and differentiates document content', () => {
    expect(nextEditDocumentDigest('const a = 1')).toBe(nextEditDocumentDigest('const a = 1'))
    expect(nextEditDocumentDigest('const a = 1')).not.toBe(nextEditDocumentDigest('const a = 2'))
  })
})

describe('shiftEditsAfterApply (multi-hunk line bookkeeping)', () => {
  it('shifts hunks BELOW the applied range by the line-count delta', () => {
    // Applied: lines 2-3 (2 lines) replaced by 4 lines → delta +2.
    const applied = hunk({ startLine: 2, endLine: 3, replacement: 'a\nb\nc\nd' })
    const rest = [hunk({ startLine: 10, endLine: 11 }), hunk({ startLine: 1, endLine: 1 })]
    const shifted = shiftEditsAfterApply(rest, applied)
    expect(shifted[0]).toMatchObject({ startLine: 12, endLine: 13 }) // below → shifted
    expect(shifted[1]).toMatchObject({ startLine: 1, endLine: 1 }) // above → untouched
  })

  it('shifts DOWN when the replacement shrinks the range', () => {
    // 3 lines replaced by 1 → delta −2.
    const applied = hunk({ startLine: 5, endLine: 7, replacement: 'one' })
    const shifted = shiftEditsAfterApply([hunk({ startLine: 9, endLine: 9 })], applied)
    expect(shifted[0]).toMatchObject({ startLine: 7, endLine: 7 })
  })

  it('returns the list unchanged for a same-size replacement', () => {
    const applied = hunk({ startLine: 2, endLine: 2, replacement: 'x' })
    const rest = [hunk({ startLine: 8, endLine: 8 })]
    expect(shiftEditsAfterApply(rest, applied)).toBe(rest) // identity — no delta
  })
})

describe('createNextEditCache (identical-input result cache)', () => {
  it('keys differ by content and cursor', () => {
    // Keyed exactly the way the live driver keys it: digest + cursor, never raw content.
    const key = (content: string, line: number, column: number) =>
      nextEditCacheKeyFromDigest(nextEditDocumentDigest(content), line, column)
    expect(key('abc', 1, 0)).toBe(key('abc', 1, 0))
    expect(key('abc', 1, 0)).not.toBe(key('abd', 1, 0))
    expect(key('abc', 1, 0)).not.toBe(key('abc', 2, 0))
    expect(key('abc', 1, 0)).not.toBe(key('abc', 1, 3))
  })

  it('serves a hit with COPIES (host consumption never corrupts the cache)', () => {
    const cache = createNextEditCache(() => 0)
    const edits = [hunk({ startLine: 2, endLine: 2 })]
    cache.set('k', edits)
    const first = cache.get('k')
    first!.edits![0].startLine = 999 // consumer mutates its copy
    expect(cache.get('k')!.edits![0].startLine).toBe(2) // cache unaffected
  })

  it('caches null results too (undo/redo of a "nothing to predict" state is free)', () => {
    const cache = createNextEditCache(() => 0)
    cache.set('k', null)
    expect(cache.get('k')).toEqual({ edits: null })
    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires negative entries quickly and positive entries after their longer TTL', () => {
    let now = 0
    const cache = createNextEditCache(() => now)
    cache.set('k', null)
    now = 10 * 1000 + 1
    expect(cache.get('k')).toBeUndefined()
    cache.set('positive', [hunk({ startLine: 1, endLine: 1 })])
    now += 90 * 1000 + 1
    expect(cache.get('positive')).toBeUndefined()
  })

  it('evicts the least-recently-used entry at capacity', () => {
    const cache = createNextEditCache(() => 0)
    for (let i = 0; i < 8; i++) cache.set(`k${i}`, null)
    cache.get('k0') // refresh k0 → k1 becomes the oldest
    cache.set('k8', null) // over capacity
    expect(cache.get('k0')).toBeDefined()
    expect(cache.get('k1')).toBeUndefined()
  })
})

describe('drift guard for a next-edit prediction', () => {
  const docLines = ['a', 'b', 'c', 'd']

  it('is not drifted when the anchor still matches the live doc', () => {
    expect(isSuggestionDrifted(docLines, { startLine: 2, endLine: 3, original: 'b\nc' })).toBe(
      false,
    )
  })

  it('is drifted when the anchor text changed since propose-time', () => {
    expect(isSuggestionDrifted(docLines, { startLine: 2, endLine: 3, original: 'b\nX' })).toBe(true)
  })
})

describe('narrowTypedThroughSuggestion (typing the prediction out by hand)', () => {
  const view = (lines: readonly string[]) => ({
    lineCount: lines.length,
    lineContent: (line: number) => lines[line - 1] ?? '',
  })

  it('re-anchors a hunk whose region became a strict prefix of the replacement', () => {
    const narrowed = narrowTypedThroughSuggestion(
      view(['const total = su']),
      hunk({
        startLine: 1,
        endLine: 1,
        original: 'const total = ',
        replacement: 'const total = sum(a, b)',
      }),
    )

    expect(narrowed).toMatchObject({ startLine: 1, endLine: 1, original: 'const total = su' })
    expect(narrowed?.replacement).toBe('const total = sum(a, b)')
  })

  it('prefers the longest matching span so multi-line typing keeps its progress', () => {
    const narrowed = narrowTypedThroughSuggestion(
      view(['if (ok) {', '  run()', 'tail']),
      hunk({
        startLine: 1,
        endLine: 1,
        original: 'if (ok) {',
        replacement: 'if (ok) {\n  run()\n}',
      }),
    )

    expect(narrowed).toMatchObject({ endLine: 2, original: 'if (ok) {\n  run()' })
  })

  it('drops the hunk once the region equals the replacement', () => {
    expect(
      narrowTypedThroughSuggestion(
        view(['const total = sum(a, b)']),
        hunk({
          startLine: 1,
          endLine: 1,
          original: 'const total = ',
          replacement: 'const total = sum(a, b)',
        }),
      ),
    ).toBeNull()
  })

  it('drops the hunk when the buffer diverged from the replacement', () => {
    expect(
      narrowTypedThroughSuggestion(
        view(['const total = pr']),
        hunk({
          startLine: 1,
          endLine: 1,
          original: 'const total = ',
          replacement: 'const total = sum(a, b)',
        }),
      ),
    ).toBeNull()
  })

  it('accepts a deletion that leaves a prefix of the replacement', () => {
    expect(
      narrowTypedThroughSuggestion(
        view(['const total = su']),
        hunk({
          startLine: 1,
          endLine: 1,
          original: 'const total = sux',
          replacement: 'const total = sum(a, b)',
        }),
      ),
    ).toMatchObject({ original: 'const total = su' })
  })

  it('never reads past the end of the buffer', () => {
    expect(
      narrowTypedThroughSuggestion(
        view(['a']),
        hunk({ startLine: 1, endLine: 1, original: 'a', replacement: 'a\nb\nc' }),
      ),
    ).toMatchObject({ endLine: 1, original: 'a' })
    expect(
      narrowTypedThroughSuggestion(
        view(['a']),
        hunk({ startLine: 4, endLine: 4, original: 'a', replacement: 'ab' }),
      ),
    ).toBeNull()
  })
})

describe('rotateHunks (Alt+]/Alt+[ hunk navigation)', () => {
  const list = [
    hunk({ startLine: 1, endLine: 1 }),
    hunk({ startLine: 5, endLine: 5 }),
    hunk({ startLine: 9, endLine: 9 }),
  ]

  it('next moves the head to the tail so the following hunk becomes current', () => {
    const rot = rotateHunks(list, 'next')
    expect(rot.map((e) => e.startLine)).toEqual([5, 9, 1])
  })

  it('prev moves the tail to the head', () => {
    const rot = rotateHunks(list, 'prev')
    expect(rot.map((e) => e.startLine)).toEqual([9, 1, 5])
  })

  it('next then prev restores the original order', () => {
    expect(rotateHunks(rotateHunks(list, 'next'), 'prev').map((e) => e.startLine)).toEqual([
      1, 5, 9,
    ])
  })

  it('is a no-op for a 0- or 1-hunk list (returns the same reference)', () => {
    const one = [hunk({ startLine: 2, endLine: 2 })]
    expect(rotateHunks(one, 'next')).toBe(one)
    expect(rotateHunks([], 'prev')).toEqual([])
  })

  it('preserves every hunk (rotation, not mutation)', () => {
    expect(rotateHunks(list, 'next')).toHaveLength(list.length)
    expect(list.map((e) => e.startLine)).toEqual([1, 5, 9]) // input untouched
  })
})
