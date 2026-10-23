import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RESULT_ROW_CAP } from '../../../shared/result-cap'
import { adaptResult } from '../../model/resultAdapter'
import { ResultFooter } from './ResultFooter'
import { rowCountLabel } from './format'

describe('ResultFooter', () => {
  test('renders query metadata as a flat IDE status line', () => {
    const html = renderToStaticMarkup(
      <ResultFooter shownRows={50} totalRows={125} durationMs={18} />,
    )

    expect(html).toContain('50 of 125 rows')
    expect(html).toContain('18 ms')
    // The result reaches the chat on its own; the footer offers no drag grip.
    expect(html).not.toContain('Drag')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('shadow-sm')
  })

  test('a capped result says FIRST rows and explains why, never reading as its size', () => {
    const html = renderToStaticMarkup(
      <ResultFooter
        shownRows={RESULT_ROW_CAP}
        totalRows={RESULT_ROW_CAP}
        truncated
        durationMs={18}
      />,
    )
    expect(html).toContain(`First ${RESULT_ROW_CAP.toLocaleString()} rows`)
    expect(html).toContain('text-status-warning')
    expect(html).toContain('Add a LIMIT')
  })
})

describe('rowCountLabel', () => {
  test('one wording for whole, filtered and capped results', () => {
    expect(rowCountLabel(1, 1)).toBe('1 row')
    expect(rowCountLabel(3, 3)).toBe('3 rows')
    expect(rowCountLabel(2, 3)).toBe('2 of 3 rows')
    expect(rowCountLabel(10, 10, true)).toBe('First 10 rows')
    expect(rowCountLabel(4, 10, true)).toBe('4 of first 10 rows')
  })

  test('the adapter carries the flag from the wire to the view', () => {
    const base = { columns: [{ name: 'n' }], rows: [[1]], durationMs: 1 }
    expect(adaptResult({ ...base, truncated: true }).truncated).toBe(true)
    expect(adaptResult(base).truncated).toBeUndefined()
  })
})
