import { describe, expect, it } from 'bun:test'
import type { LspDiagnostic } from '@/shared/api/contracts'
import { problemBadge, problemCounts, severityBucket } from './problemsCount'

const d = (severity?: number): LspDiagnostic =>
  ({
    severity,
    message: 'x',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  }) as unknown as LspDiagnostic

describe('severityBucket', () => {
  it('maps ranks to 3 buckets, undefined -> error', () => {
    expect(severityBucket(1)).toBe(1)
    expect(severityBucket(2)).toBe(2)
    expect(severityBucket(3)).toBe(3)
    expect(severityBucket(4)).toBe(3) // hint folds into info
    expect(severityBucket(undefined)).toBe(1)
  })
})

describe('problemCounts', () => {
  it('is zero for empty / nullish input', () => {
    expect(problemCounts(null)).toEqual({ errors: 0, warnings: 0 })
    expect(problemCounts({})).toEqual({ errors: 0, warnings: 0 })
  })

  it('counts errors and warnings across files, ignoring info/hint', () => {
    const counts = problemCounts({
      '/a.ts': [d(1), d(1), d(2)],
      '/b.ts': [d(2), d(3), d(4), d(undefined)],
    })
    // errors: 2 (a) + 1 (undefined in b) = 3; warnings: 1 (a) + 1 (b) = 2
    expect(counts).toEqual({ errors: 3, warnings: 2 })
  })
})

describe('problemBadge', () => {
  it('is null when there is nothing to flag', () => {
    expect(problemBadge({ '/a.ts': [d(3), d(4)] })).toBeNull()
    expect(problemBadge({})).toBeNull()
  })

  it('uses error tone when any error is present', () => {
    expect(problemBadge({ '/a.ts': [d(1), d(2), d(2)] })).toEqual({ count: 3, tone: 'error' })
  })

  it('uses warn tone when only warnings are present', () => {
    expect(problemBadge({ '/a.ts': [d(2), d(2)] })).toEqual({ count: 2, tone: 'warn' })
  })
})
