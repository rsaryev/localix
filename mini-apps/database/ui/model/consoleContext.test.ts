import { describe, expect, test } from 'bun:test'
import type { ResultTab } from './resultTabs'
import { activeResultFacet, draftFacet, OUTPUT_CONTEXT_TAIL, outputFacet } from './consoleContext'
import { mergeMessageContext } from './mergeMessageContext'

const cols = [{ id: 'c0', title: 'name' }]
const result = {
  id: 'r1',
  kind: 'result',
  label: 'SELECT name FROM users',
  seq: 1,
  sql: 'SELECT name FROM users',
  outcome: { result: { columns: cols, rows: [{ c0: 'Alice' }] }, durationMs: 1 },
} as unknown as ResultTab
const entry = (i: number, status: 'ok' | 'error' = 'ok') => ({
  at: i,
  db: 'app',
  sql: `SELECT ${i}`,
  status,
  kind: status === 'error' ? 'error' : 'select',
  message: status === 'error' ? 'no such table: userz' : '1 row retrieved',
  durationMs: 0,
})
const output = (count: number, lastError = false) =>
  ({
    id: 'out',
    kind: 'output',
    label: 'Output',
    seq: 0,
    log: Array.from({ length: count }, (_, i) =>
      entry(i, lastError && i === count - 1 ? 'error' : 'ok'),
    ),
  }) as unknown as ResultTab

describe('console context facets (what reaches the chat without a drag)', () => {
  test('the result the reader is looking at carries its rows AND the query that produced them', () => {
    const facet = activeResultFacet([output(1), result], 'r1', 'app')
    expect(facet?.label).toBe('SELECT name FROM users — app')
    expect(facet?.content).toContain('Query:\nSELECT name FROM users')
    expect(facet?.content).toContain('name\nAlice')
  })

  test('no result facet while the Output tab is the active one', () => {
    expect(activeResultFacet([output(1), result], 'out', 'app')).toBeNull()
  })

  test('the Output facet is the recent tail, and a failed run is in it', () => {
    const facet = outputFacet([output(OUTPUT_CONTEXT_TAIL + 5, true)], 'app')
    expect(facet?.content).toContain(
      `(last ${OUTPUT_CONTEXT_TAIL} of ${OUTPUT_CONTEXT_TAIL + 5} entries)`,
    )
    expect(facet?.content).toContain('no such table: userz')
    expect(facet?.content).not.toContain('SELECT 0\n')
  })

  test('an empty draft and an empty log publish nothing', () => {
    expect(draftFacet({ label: 'd', content: '  \n', language: 'sql' })).toBeNull()
    expect(outputFacet([output(0)], 'app')).toBeNull()
  })
})

describe('mergeMessageContext (two authors, one tab slot)', () => {
  const facet = { label: 'Output — app', content: 'x', language: 'text' }

  test('no file-view publication: the runner facets are APPENDED beside the static file', () => {
    expect(mergeMessageContext(null, [facet])?.strategy).toBe('append')
    expect(mergeMessageContext(null, [])).toBeNull()
  })

  test('a file-view selection keeps its replace strategy and comes first', () => {
    const own = {
      strategy: 'replace' as const,
      bindings: [{ kind: 'context', source: 'mini-app', target: { kind: 'snippet' } }] as never,
    }
    const merged = mergeMessageContext(own, [facet])
    expect(merged?.strategy).toBe('replace')
    expect(merged?.bindings[0]).toBe(own.bindings[0])
    expect(merged?.bindings).toHaveLength(2)
  })
})
