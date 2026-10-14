import { describe, expect, test } from 'bun:test'
import { parseRipgrepMatches } from './ripgrep-parse'

/** Build one ripgrep `--json` "match" event line. */
const matchEvent = (path: string, line: number, text: string, start: number, end: number): string =>
  JSON.stringify({
    type: 'match',
    data: {
      path: { text: path },
      lines: { text: `${text}\n` },
      line_number: line,
      submatches: [{ start, end }],
    },
  })

/** Build one ripgrep `--json` "context" event line. */
const contextEvent = (path: string, line: number, text: string): string =>
  JSON.stringify({
    type: 'context',
    data: { path: { text: path }, lines: { text: `${text}\n` }, line_number: line },
  })

describe('parseRipgrepMatches', () => {
  test('parses match events into flat matches with char offsets', () => {
    const stdout = [matchEvent('./src/a.ts', 3, 'const foo = 1', 6, 9)].join('\n')
    const { matches, truncated } = parseRipgrepMatches(stdout, { limit: 100 })
    expect(truncated).toBe(false)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      path: 'src/a.ts',
      line: 3,
      lineText: 'const foo = 1',
      matchStart: 6,
      matchEnd: 9,
    })
    // No context requested → no before/after.
    expect(matches[0]?.before).toBeUndefined()
    expect(matches[0]?.after).toBeUndefined()
  })

  test('ignores non-match/context events and malformed lines', () => {
    const stdout = [
      JSON.stringify({ type: 'begin', data: { path: { text: './x' } } }),
      'not json',
      matchEvent('./x', 1, 'hit', 0, 3),
      JSON.stringify({ type: 'end' }),
      '',
    ].join('\n')
    const { matches } = parseRipgrepMatches(stdout, { limit: 100 })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.path).toBe('x')
  })

  test('attaches contiguous before/after context runs to a match', () => {
    const stdout = [
      contextEvent('./a.ts', 1, 'line one'),
      contextEvent('./a.ts', 2, 'line two'),
      matchEvent('./a.ts', 3, 'MATCH here', 0, 5),
      contextEvent('./a.ts', 4, 'line four'),
      contextEvent('./a.ts', 5, 'line five'),
    ].join('\n')
    const { matches } = parseRipgrepMatches(stdout, { limit: 100, contextLines: 2 })
    expect(matches[0]?.before).toEqual(['line one', 'line two'])
    expect(matches[0]?.after).toEqual(['line four', 'line five'])
  })

  test('stops a context run at a gap (adjacent match, missing line)', () => {
    // Only line 2 present as context; line 1 absent → before is just line 2.
    const stdout = [
      contextEvent('./a.ts', 2, 'just above'),
      matchEvent('./a.ts', 3, 'MATCH', 0, 5),
      contextEvent('./a.ts', 5, 'not adjacent'), // line 4 missing → after empty
    ].join('\n')
    const { matches } = parseRipgrepMatches(stdout, { limit: 100, contextLines: 2 })
    expect(matches[0]?.before).toEqual(['just above'])
    expect(matches[0]?.after).toBeUndefined()
  })

  test('does not attach context when contextLines is 0 even if context events exist', () => {
    const stdout = [
      contextEvent('./a.ts', 2, 'above'),
      matchEvent('./a.ts', 3, 'MATCH', 0, 5),
    ].join('\n')
    const { matches } = parseRipgrepMatches(stdout, { limit: 100, contextLines: 0 })
    expect(matches[0]?.before).toBeUndefined()
  })

  test('caps matches at the limit and flags truncated', () => {
    const stdout = Array.from({ length: 5 }, (_, i) => matchEvent('./a.ts', i + 1, 'x', 0, 1)).join(
      '\n',
    )
    const { matches, truncated } = parseRipgrepMatches(stdout, { limit: 3 })
    expect(matches).toHaveLength(3)
    expect(truncated).toBe(true)
  })

  test('records trailing context of the final included match before truncating', () => {
    const stdout = [
      matchEvent('./a.ts', 1, 'one', 0, 3),
      matchEvent('./a.ts', 2, 'two', 0, 3),
      contextEvent('./a.ts', 3, 'after-two'), // trailing context of the 2nd (last kept) match
      matchEvent('./a.ts', 4, 'three', 0, 3), // over limit → truncates here
    ].join('\n')
    const { matches, truncated } = parseRipgrepMatches(stdout, { limit: 2, contextLines: 1 })
    expect(matches).toHaveLength(2)
    expect(truncated).toBe(true)
    expect(matches[1]?.after).toEqual(['after-two'])
  })

  test('expands multiple submatches on one line into separate matches', () => {
    const stdout = JSON.stringify({
      type: 'match',
      data: {
        path: { text: './a.ts' },
        lines: { text: 'ab ab\n' },
        line_number: 1,
        submatches: [
          { start: 0, end: 2 },
          { start: 3, end: 5 },
        ],
      },
    })
    const { matches } = parseRipgrepMatches(stdout, { limit: 100 })
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ matchStart: 0, matchEnd: 2 })
    expect(matches[1]).toMatchObject({ matchStart: 3, matchEnd: 5 })
  })
})
