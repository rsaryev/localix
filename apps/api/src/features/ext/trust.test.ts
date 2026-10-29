import { describe, expect, test } from 'bun:test'
import { trustFallback } from './trust'

describe('trustFallback', () => {
  test('only a plain bundled artifact runs without anyone saying so', () => {
    expect(trustFallback('bundled')).toBe('allow')
    expect(trustFallback('opt-in')).toBe('ask')
    expect(trustFallback('untrusted')).toBe('ask')
  })

  test('nothing here ever answers deny', () => {
    // A class is a fact about the artifact, not a refusal. Refusing is a rule's job, and
    // keeping the two apart is what lets `plugin:* untrusted allow` mean what it says.
    for (const trust of ['bundled', 'opt-in', 'untrusted'] as const) {
      expect(trustFallback(trust)).not.toBe('deny')
    }
  })
})
