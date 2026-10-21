import { describe, expect, test } from 'bun:test'
import { classifyExpansionBudget, type ParsedContextRef } from '@localixai/api/context-refs'
import { inlineExpansion, summarizeRefBudget } from './contextRefBudget'

const TOKENS = 1000
const blockChars = (() => {
  let chars = 1000
  while (classifyExpansionBudget(chars, TOKENS) !== 'block') chars *= 2
  return chars
})()
const warnChars = (() => {
  let chars = 1
  while (classifyExpansionBudget(chars, TOKENS) === 'ok') chars *= 2
  return chars
})()

describe('summarizeRefBudget', () => {
  test('no refs is always ok', () => {
    expect(
      summarizeRefBudget({
        manualChars: blockChars,
        totalChars: blockChars,
        hasAnyRef: false,
        contextTokens: TOKENS,
      }),
    ).toEqual({ budget: 'ok', budgetMessage: null })
  })

  test('manual overflow blocks', () => {
    const result = summarizeRefBudget({
      manualChars: blockChars,
      totalChars: blockChars,
      hasAnyRef: true,
      contextTokens: TOKENS,
    })
    expect(result.budget).toBe('block')
    expect(result.budgetMessage).toStartWith('Manual references expand')
  })

  test('ambient overflow only warns', () => {
    const result = summarizeRefBudget({
      manualChars: 0,
      totalChars: blockChars,
      hasAnyRef: true,
      contextTokens: TOKENS,
    })
    expect(result.budget).toBe('warn')
    expect(result.budgetMessage).toContain('omitted automatically')
  })

  test('combined warn level', () => {
    const result = summarizeRefBudget({
      manualChars: 0,
      totalChars: warnChars,
      hasAnyRef: true,
      contextTokens: TOKENS,
    })
    expect(classifyExpansionBudget(warnChars, TOKENS)).toBe('warn')
    expect(result.budget).toBe('warn')
    expect(result.budgetMessage).toContain('>25% of the context window')
  })
})

describe('inlineExpansion', () => {
  test('sizes inline content locally and keeps language', () => {
    const ref = {
      raw: '@snippet',
      key: 'k',
      content: 'abc',
      language: 'sql',
    } as unknown as ParsedContextRef
    expect(inlineExpansion(ref)).toEqual({
      raw: '@snippet',
      ok: true,
      content: 'abc',
      chars: 3,
      language: 'sql',
    })
  })
})
