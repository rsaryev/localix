import { describe, expect, test } from 'bun:test'

import { evaluateCondition, validateCondition, type MonitorSample } from './conditions'

const sample = (over: Partial<MonitorSample> = {}): MonitorSample => ({
  stdout: '',
  stderr: '',
  exitCode: 0,
  ...over,
})

describe('evaluateCondition', () => {
  test('exit_zero follows the exit code and quotes the output when it failed', () => {
    expect(evaluateCondition(sample({ exitCode: 0 }), { kind: 'exit_zero' }).satisfied).toBe(true)
    const failed = evaluateCondition(sample({ exitCode: 7, stdout: 'connection refused' }), {
      kind: 'exit_zero',
    })
    expect(failed.satisfied).toBe(false)
    // The detail is what the agent reads in the wake — it must carry the evidence.
    expect(failed.detail).toContain('7')
    expect(failed.detail).toContain('connection refused')
  })

  test('text predicates read stderr as well as stdout', () => {
    // A one-line check (`curl -sf`, `gh run view`) writes its failure to stderr. Matching
    // stdout alone made a failing check look like a quiet one.
    const found = evaluateCondition(sample({ stderr: 'FAILED: 3 tests' }), {
      kind: 'contains',
      value: 'FAILED',
    })
    expect(found.satisfied).toBe(true)
  })

  test('not_contains waits for the text to disappear', () => {
    expect(
      evaluateCondition(sample({ stdout: 'status: pending' }), {
        kind: 'not_contains',
        value: 'pending',
      }).satisfied,
    ).toBe(false)
    expect(
      evaluateCondition(sample({ stdout: 'status: done' }), {
        kind: 'not_contains',
        value: 'pending',
      }).satisfied,
    ).toBe(true)
  })

  test('regex covers every terminal state, and reports which one matched', () => {
    const when = { kind: 'regex', value: 'success|failed|canceled' } as const
    expect(evaluateCondition(sample({ stdout: 'running' }), when).satisfied).toBe(false)
    const verdict = evaluateCondition(sample({ stdout: 'failed' }), when)
    expect(verdict.satisfied).toBe(true)
    // Which alternative fired is the whole point of a multi-state condition.
    expect(verdict.detail).toContain('failed')
  })

  test('number reads a json_path value and compares the bounds', () => {
    const when = {
      kind: 'number',
      bound: { gte: 35 },
      jsonPath: '$.current.temp_c',
    } as const
    const cold = evaluateCondition(sample({ stdout: '{"current":{"temp_c":21.4}}' }), when)
    expect(cold.satisfied).toBe(false)
    expect(cold.detail).toContain('21.4')
    const hot = evaluateCondition(sample({ stdout: '{"current":{"temp_c":36.2}}' }), when)
    expect(hot.satisfied).toBe(true)
    expect(hot.detail).toContain('36.2')
  })

  test('number accepts a numeric STRING at the path and bracket indexes', () => {
    const verdict = evaluateCondition(sample({ stdout: '{"jobs":[{"pct":"88"}]}' }), {
      kind: 'number',
      bound: { gte: 80 },
      jsonPath: 'jobs[0].pct',
    })
    expect(verdict.satisfied).toBe(true)
  })

  test('number without json_path takes the first number in the output', () => {
    expect(
      evaluateCondition(sample({ stdout: 'queue depth 4 of 100' }), {
        kind: 'number',
        bound: { lte: 5 },
      }).satisfied,
    ).toBe(true)
  })

  test('a shape that changed is NOT satisfied, and says so', () => {
    // A monitor must never read a missing value as a met condition — that would wake the
    // agent claiming something happened when the API simply returned different JSON.
    const verdict = evaluateCondition(sample({ stdout: '{"error":"gone"}' }), {
      kind: 'number',
      bound: { gte: 1 },
      jsonPath: '$.current.temp_c',
    })
    expect(verdict.satisfied).toBe(false)
    expect(verdict.detail).toContain('$.current.temp_c')
  })

  test('malformed JSON with a json_path is unsatisfied rather than throwing', () => {
    expect(() =>
      evaluateCondition(sample({ stdout: '<html>502</html>' }), {
        kind: 'number',
        bound: { gte: 1 },
        jsonPath: '$.value',
      }),
    ).not.toThrow()
  })

  test('an invalid regex can never read as satisfied', () => {
    // Unreachable through the tool (validateCondition rejects it first), but the fallback
    // must fail CLOSED: a monitor that fires on a broken predicate is worse than one that
    // never fires.
    const verdict = evaluateCondition(sample({ stdout: 'anything' }), {
      kind: 'regex',
      value: '(',
    })
    expect(verdict.satisfied).toBe(false)
  })
})

describe('validateCondition', () => {
  test('rejects what can never work, at start', () => {
    expect(validateCondition({ kind: 'regex', value: '([' })).toContain('Invalid regex')
    expect(validateCondition({ kind: 'contains', value: '' })).toContain('empty string')
    expect(validateCondition({ kind: 'number', bound: {} })).toContain('gte / lte / eq')
    expect(validateCondition({ kind: 'number', bound: { gte: 10, lte: 5 } })).toContain(
      'Impossible range',
    )
  })

  test('accepts usable conditions', () => {
    expect(validateCondition({ kind: 'exit_zero' })).toBeNull()
    expect(validateCondition({ kind: 'regex', value: 'success|failed' })).toBeNull()
    expect(validateCondition({ kind: 'number', bound: { gte: 35 } })).toBeNull()
  })
})
