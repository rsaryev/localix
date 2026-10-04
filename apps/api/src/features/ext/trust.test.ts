import { describe, expect, test } from 'bun:test'
import { trustClassOf, trustFallback } from './trust'

const facts = (over: Partial<Parameters<typeof trustClassOf>[0]> = {}) => ({
  isBundled: true,
  isCodeBearing: false,
  defaultEnabled: undefined,
  ...over,
})

describe('trustClassOf', () => {
  test('the bundle boundary is the trust boundary', () => {
    // A folder appearing under `~/.localix/plugins` is not a decision anybody made, and a
    // manifest is written by whoever wrote the artifact — so its own `defaultEnabled: true`
    // cannot promote it. This is the one rule the class exists to state.
    for (const isCodeBearing of [true, false]) {
      for (const defaultEnabled of [true, false, undefined]) {
        expect(trustClassOf(facts({ isBundled: false, isCodeBearing, defaultEnabled }))).toBe(
          'untrusted',
        )
      }
    }
  })

  test('ours, code-bearing, and silent about it: opt-in', () => {
    expect(trustClassOf(facts({ isCodeBearing: true }))).toBe('opt-in')
    expect(trustClassOf(facts({ isCodeBearing: true, defaultEnabled: true }))).toBe('bundled')
  })

  test('ours and code-free: bundled, unless the manifest opts out', () => {
    expect(trustClassOf(facts())).toBe('bundled')
    expect(trustClassOf(facts({ defaultEnabled: true }))).toBe('bundled')
    expect(trustClassOf(facts({ defaultEnabled: false }))).toBe('opt-in')
  })
})

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
