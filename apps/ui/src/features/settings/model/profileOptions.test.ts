import { describe, expect, test } from 'bun:test'
import { splitStyleTokens, hasStyleToken, toggleStyleToken } from './profileOptions'

describe('splitStyleTokens', () => {
  test('splits, trims, and drops empty tokens', () => {
    expect(splitStyleTokens('concise,  code first ,, ')).toEqual(['concise', 'code first'])
  })
  test('blank / undefined → empty list', () => {
    expect(splitStyleTokens('   ')).toEqual([])
    expect(splitStyleTokens(undefined)).toEqual([])
  })
})

describe('hasStyleToken', () => {
  test('matches case-insensitively', () => {
    expect(hasStyleToken('Concise, code first', 'concise')).toBe(true)
    expect(hasStyleToken('concise', 'show examples')).toBe(false)
  })
})

describe('toggleStyleToken', () => {
  test('adds a phrase to empty / existing text', () => {
    expect(toggleStyleToken('', 'concise')).toBe('concise')
    expect(toggleStyleToken('concise', 'code first')).toBe('concise, code first')
  })
  test('removes a present phrase (case-insensitive) and preserves the rest', () => {
    expect(toggleStyleToken('Concise, code first', 'concise')).toBe('code first')
  })
  test('preserves hand-typed custom tokens through a toggle round-trip', () => {
    const custom = 'reply in terse prose'
    const on = toggleStyleToken(custom, 'concise')
    expect(splitStyleTokens(on)).toEqual(['reply in terse prose', 'concise'])
    const off = toggleStyleToken(on, 'concise')
    expect(off).toBe('reply in terse prose') // custom token survives
  })
})
