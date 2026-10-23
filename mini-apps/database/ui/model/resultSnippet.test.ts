import { describe, expect, it } from 'bun:test'
import type { TableRow } from '@localixai/dataview'
import { formatResultSnippet, tabToSnippet, MAX_SNIPPET_ROWS } from './resultSnippet'
import type { ResultTab } from './resultTabs'

const cols = [
  { id: 'c0', title: 'id' },
  { id: 'c1', title: 'name' },
]

describe('formatResultSnippet', () => {
  it('renders a tab-separated header + rows', () => {
    const out = formatResultSnippet(cols, [
      { c0: 1, c1: 'Ann' },
      { c0: 2, c1: 'Bob' },
    ])
    expect(out).toBe('id\tname\n1\tAnn\n2\tBob')
  })

  it('prepends a label when given', () => {
    const out = formatResultSnippet(cols, [{ c0: 1, c1: 'Ann' }], { label: 'Query result — app' })
    expect(out).toBe('Query result — app\n\nid\tname\n1\tAnn')
  })

  it('caps rows and notes the remainder', () => {
    const rows = Array.from({ length: MAX_SNIPPET_ROWS + 5 }, (_, i) => ({ c0: i, c1: `n${i}` }))
    const out = formatResultSnippet(cols, rows)
    expect(out).toContain(`… 5 more rows (showing ${MAX_SNIPPET_ROWS})`)
    // header + MAX rows + the "… more" line
    expect(out.split('\n').length).toBe(1 + MAX_SNIPPET_ROWS + 1)
  })

  it('formats objects as JSON and null as an empty cell via formatCell (matches the grid)', () => {
    // jsonb columns arrive as JS objects at runtime (wider than the TableRow cell type).
    const out = formatResultSnippet(cols, [{ c0: null, c1: { a: 1 } } as unknown as TableRow])
    expect(out).toBe('id\tname\n\t{"a":1}')
  })

  it('header-only for an empty result', () => {
    expect(formatResultSnippet(cols, [])).toBe('id\tname')
  })
})

describe('tabToSnippet (drag a result tab into chat)', () => {
  it('maps a query-result tab to a labelled table snippet', () => {
    const tab = {
      id: 't1',
      kind: 'result',
      label: 'SELECT * FROM users',
      seq: 0,
      outcome: { result: { columns: cols, rows: [{ c0: 1, c1: 'Ann' }] }, durationMs: 1 },
    } as unknown as ResultTab
    const snip = tabToSnippet(tab, 'app')
    expect(snip?.label).toBe('SELECT * FROM users — app')
    expect(snip?.content).toContain('id\tname')
    expect(snip?.content).toContain('1\tAnn')
  })

  it('returns null for a rows-affected result tab (no grid to link)', () => {
    const tab = {
      id: 't2',
      kind: 'result',
      label: 'UPDATE users',
      seq: 0,
      outcome: { result: null, rowsAffected: 3, durationMs: 1 },
    } as unknown as ResultTab
    expect(tabToSnippet(tab, 'app')).toBeNull()
  })

  it('returns null for an empty Output tab', () => {
    const tab = {
      id: 'out',
      kind: 'output',
      label: 'Output',
      seq: 0,
      log: [],
    } as unknown as ResultTab
    expect(tabToSnippet(tab, 'app')).toBeNull()
  })

  it('maps a non-empty Output tab to an "Output — <conn>" snippet', () => {
    const tab = {
      id: 'out',
      kind: 'output',
      label: 'Output',
      seq: 0,
      log: [
        {
          at: 0,
          db: 'app',
          sql: 'SELECT 1',
          durationMs: 1,
          status: 'ok',
          kind: 'select',
          rowCount: 1,
          message: '1 row retrieved',
        },
      ],
    } as unknown as ResultTab
    const snip = tabToSnippet(tab, 'app')
    expect(snip?.label).toBe('Output — app')
    expect(snip?.content.length).toBeGreaterThan(0)
  })
})
