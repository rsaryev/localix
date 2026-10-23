import { describe, expect, test } from 'bun:test'

import {
  problemConsequenceLabel,
  problemReportDedupeKey,
  problemReportTitle,
  problemSubjectKey,
  sortProblems,
  worstProblemSeverity,
  type Problem,
  type ProblemReport,
} from './problems'

const problem = (over: Partial<Problem> = {}): Problem => ({ message: 'broken', ...over })

describe('problem severity', () => {
  test('an unstated severity is an error — nothing downgrades itself by omission', () => {
    expect(worstProblemSeverity([problem()])).toBe('error')
    expect(worstProblemSeverity([problem({ severity: 'info' }), problem()])).toBe('error')
  })

  test('a report is judged by its worst member', () => {
    expect(worstProblemSeverity([problem({ severity: 'info' })])).toBe('info')
    expect(
      worstProblemSeverity([problem({ severity: 'info' }), problem({ severity: 'warning' })]),
    ).toBe('warning')
  })

  test('an empty report has nothing to be worst about', () => {
    expect(worstProblemSeverity([])).toBe('info')
  })
})

describe('ordering', () => {
  test('worst first, then by line, then stable in producer order', () => {
    const ordered = sortProblems([
      problem({ message: 'c', severity: 'warning', location: { line: 2 } }),
      problem({ message: 'a', location: { line: 9 } }),
      problem({ message: 'b', location: { line: 4 } }),
      problem({ message: 'd', severity: 'warning', location: { line: 2 } }),
    ])
    expect(ordered.map((entry) => entry.message)).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('headline and consequence', () => {
  const report: ProblemReport = {
    subject: { label: 'board.json' },
    problems: [problem(), problem()],
  }

  test('counting is the headline once there is more than one', () => {
    expect(problemReportTitle(report)).toBe('2 problems in board.json')
  })

  test('a lone problem says what is wrong — the count would hide the only useful sentence', () => {
    expect(
      problemReportTitle({ ...report, problems: [problem({ message: 'permission denied' })] }),
    ).toBe('permission denied')
  })

  test('a report with nothing worse than notes does not say "problem"', () => {
    expect(
      problemReportTitle({
        ...report,
        problems: [problem({ severity: 'info' }), problem({ severity: 'info' })],
      }),
    ).toBe('2 notes in board.json')
  })

  test('raw engine output can never become a wall of text on the line', () => {
    // Shipped for real: the docker daemon's own sentence, forwarded verbatim into a canvas strip.
    const raw =
      'connect to the docker API at unix:///Users/me/.docker/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory'
    const line = problemReportTitle({ ...report, problems: [problem({ message: raw })] })
    expect(line.length).toBeLessThanOrEqual(121)
    expect(line.endsWith('…')).toBe(true)
  })

  test('a multi-line message is cut to its first line', () => {
    expect(
      problemReportTitle({
        ...report,
        problems: [problem({ message: 'failed\n  at foo()\n  at bar()' })],
      }),
    ).toBe('failed')
  })

  test('an explicit title wins', () => {
    expect(problemReportTitle({ ...report, title: 'Could not connect' })).toBe('Could not connect')
  })

  // Was: blocked returned "nothing is showing". Nothing ever rendered it — the line suppressed the
  // string the vocabulary handed it — so the rule now lives in one place and the assertion follows.
  test('only a stale surface has anything to add: an empty pane is not narrated', () => {
    expect(problemConsequenceLabel(report)).toBe('showing the last valid version')
    expect(problemConsequenceLabel({ ...report, consequence: 'blocked' })).toBe('')
    expect(problemConsequenceLabel({ ...report, consequence: 'none' })).toBe('')
  })
})

describe('dedupe key', () => {
  const base: ProblemReport = {
    subject: { label: 'board.json', path: '/w/board.json' },
    problems: [problem({ field: 'a.type' }), problem({ field: 'a.data' })],
  }

  test('the same problems republished coalesce, whatever order they arrive in', () => {
    const reordered: ProblemReport = { ...base, problems: [...base.problems].reverse() }
    expect(problemReportDedupeKey('space', base)).toBe(problemReportDedupeKey('space', reordered))
  })

  test('a changed problem set is a new incident', () => {
    const fixed: ProblemReport = { ...base, problems: [problem({ field: 'a.type' })] }
    expect(problemReportDedupeKey('space', fixed)).not.toBe(problemReportDedupeKey('space', base))
  })

  test('two subjects never share a row', () => {
    const other: ProblemReport = { ...base, subject: { label: 'other.json', path: '/w/o.json' } }
    expect(problemReportDedupeKey('space', other)).not.toBe(problemReportDedupeKey('space', base))
  })

  test("one subject's settle prefix never covers another subject's rows", () => {
    // Settling is a prefix match on `<subject key>:`; a label containing the separator must not
    // extend a shorter label's prefix.
    const logs = `${problemSubjectKey('devops', { label: 'logs' })}:`
    const apiLogs = problemReportDedupeKey('devops', { ...base, subject: { label: 'logs:api' } })
    expect(apiLogs.startsWith(logs)).toBe(false)
  })
})
