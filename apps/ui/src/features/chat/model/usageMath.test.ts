import { describe, expect, test } from 'bun:test'
import type { ChatUsagePayload } from '@localixai/agent'

import {
  cacheHitRate,
  combineUsage,
  selectAssistantUsage,
  selectLatestCacheDiagnostics,
  uncachedInputTokens,
} from './usageMath'

const msg = (role: string, extra: Record<string, unknown> = {}) => ({ role, ...extra }) as never

describe('cacheHitRate', () => {
  test('divides by inputTokens (which already INCLUDES cacheRead), not input+cacheRead', () => {
    // 81 cached of 100 total context → 81%. The intuitive-but-wrong
    // cacheRead/(input+cacheRead) would give 81/181 ≈ 45% — guard against it.
    expect(cacheHitRate(81, 100)).toBe(81)
    expect(cacheHitRate(1_592_320, 2_066_724)).toBe(77)
  })

  test('null when there is no input or no cache figure', () => {
    expect(cacheHitRate(50, 0)).toBeNull()
    expect(cacheHitRate(50, undefined)).toBeNull()
    expect(cacheHitRate(undefined, 100)).toBeNull()
  })

  test('zero cache reads is 0%, not null', () => {
    expect(cacheHitRate(0, 100)).toBe(0)
  })
})

describe('uncachedInputTokens', () => {
  test('subtracts both cache buckets from the total input without going negative', () => {
    expect(uncachedInputTokens(36_101, 32_768, 1_000)).toBe(2_333)
    expect(uncachedInputTokens(10, 12)).toBe(0)
  })

  test('is undefined unless both provider figures are present', () => {
    expect(uncachedInputTokens(undefined, 5)).toBeUndefined()
    expect(uncachedInputTokens(5, undefined)).toBeUndefined()
  })
})

describe('selectAssistantUsage', () => {
  test('keeps only assistant messages that recorded tokens, mapping to their usage', () => {
    const out = selectAssistantUsage([
      msg('user', { usage: { totalTokens: 5 } }), // wrong role
      msg('assistant', { usage: { totalTokens: 0 } }), // no tokens → dropped
      msg('assistant', {}), // no usage → dropped
      msg('assistant', { usage: { totalTokens: 12, inputTokens: 8 } }),
    ])
    expect(out).toEqual([{ totalTokens: 12, inputTokens: 8 }])
  })

  test('empty input → empty array', () => {
    expect(selectAssistantUsage([])).toEqual([])
  })
})

describe('selectLatestCacheDiagnostics', () => {
  test('returns the most recent assistant message cacheDiagnostics', () => {
    const out = selectLatestCacheDiagnostics([
      msg('assistant', { cacheDiagnostics: { id: 'old' } }),
      msg('user', { cacheDiagnostics: { id: 'ignored' } }),
      msg('assistant', { cacheDiagnostics: { id: 'new' } }),
      msg('assistant', {}), // newer but no diagnostics → skipped, keep 'new'
    ])
    expect(out).toEqual({ id: 'new' } as never)
  })

  test('undefined when no assistant message carried diagnostics', () => {
    expect(
      selectLatestCacheDiagnostics([
        msg('assistant', {}),
        msg('user', { cacheDiagnostics: { id: 'x' } }),
      ]),
    ).toBeUndefined()
  })
})

const u = (over: Partial<ChatUsagePayload>): ChatUsagePayload => over as ChatUsagePayload

describe('combineUsage', () => {
  test('empty list → undefined', () => {
    expect(combineUsage([])).toBeUndefined()
  })

  test('sums each field independently and marks the result a summary', () => {
    const out = combineUsage([
      u({
        totalTokens: 10,
        totalCost: 0.1,
        inputTokens: 6,
        outputTokens: 4,
        cacheWrite1hTokens: 2,
        reasoningTokens: 1,
      }),
      u({
        totalTokens: 20,
        totalCost: 0.2,
        inputTokens: 12,
        outputTokens: 8,
        cacheWrite1hTokens: 3,
        reasoningTokens: 2,
      }),
    ])
    expect(out).toMatchObject({
      totalTokens: 30,
      inputTokens: 18,
      outputTokens: 12,
      cacheWrite1hTokens: 5,
      reasoningTokens: 3,
      isSummary: true,
    })
    expect(out?.totalCost).toBeCloseTo(0.3, 10)
  })

  test('a field stays undefined when no input carried it', () => {
    const out = combineUsage([u({ totalTokens: 5 }), u({ totalTokens: 5 })])
    expect(out?.totalTokens).toBe(10)
    expect(out?.totalCost).toBeUndefined()
    expect(out?.cachedInputTokens).toBeUndefined()
  })

  test('partial presence sums only the defined values', () => {
    const out = combineUsage([u({ inputTokens: 3 }), u({ outputTokens: 7 }), u({ inputTokens: 2 })])
    expect(out?.inputTokens).toBe(5)
    expect(out?.outputTokens).toBe(7)
  })
})
