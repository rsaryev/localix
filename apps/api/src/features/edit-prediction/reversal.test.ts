import { describe, expect, it } from 'bun:test'
import type { EditPrediction } from './contracts'
import { dropReversingEdits, reversesRecentEdit } from './reversal'

const hunk = (over: Partial<EditPrediction> = {}): EditPrediction => ({
  startLine: 3,
  endLine: 3,
  original: 'const total = sum(a, b)',
  replacement: 'const total = a + b',
  ...over,
})

describe('reversesRecentEdit', () => {
  it('flags a hunk that restores the pre-edit text of an overlapping window', () => {
    // The user replaced `a + b` with `sum(a, b)`; the model offers to put it back.
    expect(
      reversesRecentEdit(hunk(), [
        {
          startLine: 2,
          endLine: 4,
          before: ['const total = a + b'],
          lines: ['const total = sum(a, b)'],
        },
      ]),
    ).toBe(true)
  })

  it('ignores trailing whitespace and surrounding blank lines when comparing', () => {
    expect(
      reversesRecentEdit(hunk({ replacement: '\nconst total = a + b   \n' }), [
        {
          startLine: 3,
          endLine: 3,
          before: ['const total = a + b'],
          lines: ['const total = sum(a, b)'],
        },
      ]),
    ).toBe(true)
  })

  it('leaves a genuine forward edit alone', () => {
    expect(
      reversesRecentEdit(hunk({ replacement: 'const total = sum(a, b, c)' }), [
        {
          startLine: 3,
          endLine: 3,
          before: ['const total = a + b'],
          lines: ['const total = sum(a, b)'],
        },
      ]),
    ).toBe(false)
  })

  it('does not reach across to a window it never touches', () => {
    expect(
      reversesRecentEdit(hunk({ startLine: 40, endLine: 40 }), [
        {
          startLine: 2,
          endLine: 4,
          before: ['const total = a + b'],
          lines: ['const total = sum(a, b)'],
        },
      ]),
    ).toBe(false)
  })

  it('needs evidence the user actually changed something', () => {
    const window = {
      startLine: 3,
      endLine: 3,
      lines: ['const total = sum(a, b)'],
    }
    // No recorded `before` — nothing says this text was ever different.
    expect(reversesRecentEdit(hunk({ replacement: 'const total = sum(a, b)' }), [window])).toBe(
      false,
    )
    // A window whose before and after agree describes an edit that was never made.
    expect(
      reversesRecentEdit(hunk({ replacement: 'const total = sum(a, b)' }), [
        { ...window, before: ['const total = sum(a, b)'] },
      ]),
    ).toBe(false)
  })

  it('cannot position a window that carries no line bounds', () => {
    expect(
      reversesRecentEdit(hunk(), [
        { before: ['const total = a + b'], lines: ['const total = sum(a, b)'] },
      ]),
    ).toBe(false)
  })

  it('says nothing about a pure-deletion hunk', () => {
    expect(
      reversesRecentEdit(hunk({ replacement: '' }), [
        {
          startLine: 3,
          endLine: 3,
          before: ['const total = a + b'],
          lines: ['const total = sum(a, b)'],
        },
      ]),
    ).toBe(false)
  })
})

describe('dropReversingEdits', () => {
  const window = {
    startLine: 3,
    endLine: 3,
    before: ['const total = a + b'],
    lines: ['const total = sum(a, b)'],
  }

  it('keeps the forward hunks and drops only the revert', () => {
    const forward = hunk({ startLine: 10, endLine: 10, replacement: 'return total' })
    const kept = dropReversingEdits([hunk(), forward], [window])
    expect(kept).toEqual([forward])
  })

  it('returns null when every hunk was a revert, never an empty prediction', () => {
    // The rest of the pipeline reads an empty survivor set as "no prediction"; an
    // empty array would render as a diff with nothing in it.
    expect(dropReversingEdits([hunk()], [window])).toBeNull()
  })

  it('passes everything through when there is no edit history to compare against', () => {
    const edits = [hunk()]
    expect(dropReversingEdits(edits, [])).toEqual(edits)
    expect(dropReversingEdits([], [])).toBeNull()
  })
})
