import { describe, expect, test } from 'bun:test'
import type { LocalModelEntry } from '@/shared/api/localModelsApi'
import { BALANCE_STOPS, DEFAULT_BALANCE, rankRecommended } from './recommendRanking'

function choice(
  label: string,
  variant: string,
  scores: NonNullable<LocalModelEntry['scores']>,
  fit: 'good' | 'tight' = 'good',
): LocalModelEntry {
  return {
    spec: {
      id: `${label}:${variant}`,
      repo: `google/${label}`,
      revision: 'r',
      variant,
      kind: 'chat',
      label,
      license: null,
      architecture: null,
      contextLength: 65536,
      vision: false,
      files: [],
      bytes: 1,
    },
    installed: false,
    featured: true,
    plan: {
      fit,
      context: 65536,
      kv: 'f16',
      memoryBytes: 1,
      shortBytes: 0,
      offloaded: false,
      tokensPerSecond: 1,
    },
    downloads: null,
    variants: [],
    exact: true,
    scores,
  }
}

const at = (label: (typeof BALANCE_STOPS)[number]['label']) =>
  BALANCE_STOPS.find((s) => s.label === label)!.value

// A 24 GB computer: the 26B fits only tightly, the 12B comfortably, E2B flies.
const small = choice('Gemma 4 E2B', 'Q4_0', { intelligence: 0.32, speed: 0.97, fidelity: 0.96 })
const mid = choice('Gemma 4 12B', 'Q4_0', { intelligence: 0.74, speed: 0.55, fidelity: 0.96 })
const large = choice(
  'Gemma 4 26B-A4B',
  'Q4_0',
  { intelligence: 0.94, speed: 0.91, fidelity: 0.96 },
  'tight',
)
const largeLow = choice('Gemma 4 26B-A4B', 'Q3_K_M', {
  intelligence: 0.94,
  speed: 0.8,
  fidelity: 0.79,
})

describe('recommended ranking', () => {
  test('Balanced, the default, keeps a comfortable fit ahead of a tight larger one', () => {
    expect(BALANCE_STOPS[DEFAULT_BALANCE]!.label).toBe('Balanced')
    const ranked = rankRecommended([small, mid, large], at('Balanced'))
    expect(ranked[0]!.spec.label).toBe('Gemma 4 12B')
  })

  test('the ends of the scale trade speed for size', () => {
    expect(rankRecommended([small, mid, large], at('Fastest'))[0]!.spec.label).toBe('Gemma 4 E2B')
    expect(rankRecommended([small, mid, large], at('Smartest'))[0]!.spec.label).toBe(
      'Gemma 4 26B-A4B',
    )
  })

  test('one width per model, the better one for the preference', () => {
    const ranked = rankRecommended([large, largeLow, mid], at('Smartest'))
    expect(ranked.map((e) => e.spec.id)).toEqual(['Gemma 4 26B-A4B:Q4_0', 'Gemma 4 12B:Q4_0'])
  })
})
