import { describe, test, expect } from 'bun:test'
import { groupMatches, modelFacingMatches, matchedFiles, truncateOutput } from './search-output'

const RG = [
  'src/a.ts:3:import { x } from "./x"',
  'src/a.ts:17:const y = x + 1',
  'src/a.ts:29:export { x }',
  'src/b.ts:5:import { x } from "./x"',
  'src/b.ts:9:use(x)',
  'src/c.test.ts:2:import { x } from "./x"',
  'src/c.test.ts:4:test("x", () => {})',
  'src/c.test.ts:8:test("x", () => {})',
  'src/c.test.ts:12:test("x", () => {})',
  'src/c.test.ts:16:test("x", () => {})',
  'src/c.test.ts:20:test("x", () => {})',
].join('\n')

describe('groupMatches', () => {
  test('groups by file, path printed once', () => {
    const out = groupMatches(RG)!
    expect(out).toContain('src/a.ts:')
    expect(out).toContain('src/b.ts:')
    // Path appears exactly once as a group header, not per line.
    expect(out.split('src/a.ts').length - 1).toBe(1)
    expect(out).toContain('  3: import { x } from "./x"')
  })
  test('collapses identical match text within a file', () => {
    const out = groupMatches(RG)!
    expect(out).toContain('4,8,12(+2 more): test("x", () => {})')
  })
  test('summary line reports totals', () => {
    expect(groupMatches(RG)).toContain('[11 matches in 3 files')
  })
  test('bails to null on unparseable lines (conservative)', () => {
    expect(groupMatches(RG + '\n[…truncated…]')).toBeNull()
  })
  test('bails on tiny result sets', () => {
    expect(groupMatches('a.ts:1:x\nb.ts:2:y')).toBeNull()
  })
})

describe('modelFacingMatches grouping integration', () => {
  test('content search gets grouped when smaller', () => {
    const out = modelFacingMatches(RG)
    expect(out).toContain('src/c.test.ts:')
    expect(out.length).toBeLessThan(RG.length)
  })
  test('file listings are never grouped', () => {
    const listing = Array.from({ length: 20 }, (_, i) => `src/file_${i}.ts`).join('\n')
    expect(modelFacingMatches(listing, 'file')).toBe(listing)
  })
})

/**
 * Provenance must survive truncation, because truncation is exactly when there is most to say.
 *
 * `search` renders its output through `truncateOutput`, which appends a `[…truncated…]` sentinel
 * and can cut the last line mid-content. `matchedFiles` is deliberately fail-closed — one line it
 * cannot parse and it returns nothing — so feeding it the RENDERED output meant every search large
 * enough to truncate published no sources at all, silently, while small ones published them fine.
 */
describe('matchedFiles against truncated output', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => `src/f${i}.ts:${i + 1}:hit`).join('\n')

  test('the sentinel alone voids the whole list — which is why the raw output is parsed', () => {
    const raw = many(20_000)
    const rendered = truncateOutput(raw)

    expect(rendered.truncated).toBe(true)
    // The behaviour that bit: not a smaller list, an EMPTY one.
    expect(matchedFiles(rendered.output)).toEqual([])
    expect(matchedFiles(raw).length).toBe(20_000)
  })

  test('a trailing sentinel is enough on its own, with nothing else wrong', () => {
    expect(matchedFiles(['a.ts:1:hit', '[…truncated…]'].join('\n'))).toEqual([])
  })
})

describe('matchedFiles', () => {
  test('one entry per FILE, at its first hit', () => {
    // A search that hits a file forty times found one place worth opening. Forty rows that all
    // open the same tab is a list nobody reads.
    expect(matchedFiles(['a.ts:12:one', 'a.ts:4:two', 'b.ts:9:three'].join('\n'))).toEqual([
      { file: 'a.ts', line: 4 },
      { file: 'b.ts', line: 9 },
    ])
  })

  test('files keep the order they were first seen', () => {
    expect(matchedFiles(['z.ts:1:x', 'a.ts:1:y'].join('\n')).map((m) => m.file)).toEqual([
      'z.ts',
      'a.ts',
    ])
  })

  test('ONE unparseable line yields nothing at all', () => {
    // The safety property the search provenance is built on: a change in ripgrep's output shape
    // must cost provenance, never produce wrong provenance. Half-understood output is not a
    // partial win.
    expect(matchedFiles(['a.ts:1:ok', 'this is not a match line'].join('\n'))).toEqual([])
  })

  test('empty output yields nothing', () => {
    expect(matchedFiles('')).toEqual([])
  })

  test('a path containing a colon still parses', () => {
    // `.+?` is non-greedy, so a leading `C:` looks like a tempting file name — the `:\d+:` anchor
    // is what keeps the whole path together.
    expect(matchedFiles('C:/src/a.ts:7:hit')).toEqual([{ file: 'C:/src/a.ts', line: 7 }])
  })
})
