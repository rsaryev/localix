import { describe, expect, test } from 'bun:test'

import {
  parseLegacyFindings,
  parseReviewReport,
  parseStructuredVerdict,
  repairTrailingCommas,
} from './verdict'

/**
 * Behavior lock for the /review structured-verdict parser. The contract under
 * test: structured extraction is layered (last fenced json block → trailing
 * balanced object → trailing-comma repair), an invalid verdict never coerces,
 * and when JSON fails entirely the report degrades to the legacy [P0]–[P3]
 * text parse with `verdict: null` (zero regression — never a synthetic fail).
 */

const GOOD = {
  verdict: 'comment',
  summary: 'two minor issues, nothing blocking',
  findings: [{ severity: 'P2', title: 'off-by-one in pager', file: 'src/pager.ts', line: 42 }],
}

describe('parseStructuredVerdict — fenced json', () => {
  test('parses a fenced ```json block at the end of prose', () => {
    const text = `Reviewed 3 files.\n\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``
    expect(parseStructuredVerdict(text)).toEqual(GOOD as never)
  })

  test('the LAST fenced json block wins (earlier fences are examples/quotes)', () => {
    const text = [
      'An example verdict looks like:',
      '```json\n{"verdict":"pass","summary":"example","findings":[]}\n```',
      'Actual result:',
      '```json\n{"verdict":"fail","summary":"broken build","findings":[]}\n```',
    ].join('\n')
    expect(parseStructuredVerdict(text)?.verdict).toBe('fail')
    expect(parseStructuredVerdict(text)?.summary).toBe('broken build')
  })

  test('normalizes verdict/severity case and drops malformed findings', () => {
    const text =
      '```json\n{"verdict":"PASS","summary":"ok","findings":[{"severity":"p1","title":"x"},{"severity":"P9","title":"bad"},{"severity":"P2","title":"  "}]}\n```'
    expect(parseStructuredVerdict(text)).toEqual({
      verdict: 'pass',
      summary: 'ok',
      findings: [{ severity: 'P1', title: 'x' }],
    })
  })
})

describe('parseStructuredVerdict — trailing object', () => {
  test('parses a fenceless trailing {…} containing "verdict"', () => {
    const text = `Summary of review.\n{"verdict":"pass","summary":"clean","findings":[]}`
    expect(parseStructuredVerdict(text)).toEqual({
      verdict: 'pass',
      summary: 'clean',
      findings: [],
    })
  })

  test('skips stray prose braces and braces inside strings', () => {
    const text =
      'The config {a:1} looked odd. {"verdict":"fail","summary":"the {block} is wrong","findings":[]}'
    expect(parseStructuredVerdict(text)?.summary).toBe('the {block} is wrong')
  })

  test('a later invalid object does not mask an earlier valid one', () => {
    const text =
      '{"verdict":"comment","summary":"ok","findings":[]}\ntrailing note {"verdict":"maybe"}'
    expect(parseStructuredVerdict(text)?.verdict).toBe('comment')
  })
})

describe('trailing-comma repair', () => {
  test('repairTrailingCommas drops object/array trailing commas, keeps string content', () => {
    expect(repairTrailingCommas('{"a":[1,2,],"b":"x, }",}')).toBe('{"a":[1,2],"b":"x, }"}')
  })

  test('a verdict block with trailing commas still parses', () => {
    const text =
      '```json\n{"verdict":"fail","summary":"s","findings":[{"severity":"P0","title":"boom",},],}\n```'
    expect(parseStructuredVerdict(text)).toEqual({
      verdict: 'fail',
      summary: 's',
      findings: [{ severity: 'P0', title: 'boom' }],
    })
  })
})

describe('legacy fallback', () => {
  test('no JSON at all → legacy [P0]-[P3] findings, verdict null', () => {
    const text = [
      'Findings:',
      '- [P1] src/auth.ts:17 — token never expires',
      '- [p3] naming nit in helper',
      'Overall: correct-with-fixes',
    ].join('\n')
    const report = parseReviewReport(text)
    expect(report.source).toBe('legacy')
    expect(report.verdict).toBeNull()
    expect(report.findings).toEqual([
      { severity: 'P1', title: 'token never expires', file: 'src/auth.ts', line: 17 },
      { severity: 'P3', title: 'naming nit in helper' },
    ])
  })

  test('invalid verdict value ("maybe") → legacy fallback, never a coerced verdict', () => {
    const text = '[P2] flaky retry loop\n```json\n{"verdict":"maybe","summary":"?"}\n```'
    const report = parseReviewReport(text)
    expect(report.source).toBe('legacy')
    expect(report.verdict).toBeNull()
    expect(report.findings).toEqual([{ severity: 'P2', title: 'flaky retry loop' }])
  })

  test('unparseable fenced block falls through to a valid trailing object', () => {
    const text =
      '```json\n{"verdict": totally broken\n```\n{"verdict":"pass","summary":"ok","findings":[]}'
    expect(parseReviewReport(text)).toEqual({
      source: 'structured',
      verdict: 'pass',
      summary: 'ok',
      findings: [],
    })
  })

  test('clean report with nothing tagged → legacy with empty findings', () => {
    const report = parseReviewReport('Everything looks correct. No findings filed.')
    expect(report).toEqual({ source: 'legacy', verdict: null, summary: null, findings: [] })
  })

  test('parseLegacyFindings tolerates tags mid-line in older reports', () => {
    expect(parseLegacyFindings('12. [P0] data loss on save')).toEqual([
      { severity: 'P0', title: 'data loss on save' },
    ])
  })
})
