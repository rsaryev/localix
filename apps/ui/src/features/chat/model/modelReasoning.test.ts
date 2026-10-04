import { describe, expect, test } from 'bun:test'
import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import {
  carriedReasoningEffort,
  clampModelReasoning,
  modelReasoningOptions,
} from './modelReasoning'

/**
 * A reasoning preference is stored per provider/model pair and outlives the model it was chosen
 * for. The runtime clamps what it cannot serve (as pi does), so the risk here is not a crash: it
 * is a picker that offers a level the model will never receive, and a chip that names it.
 */

const values = (efforts: string[] | undefined) =>
  modelReasoningOptions(efforts).map((option) => option.value)

describe('modelReasoningOptions', () => {
  test('offers only what the model declares, and always the floor', () => {
    expect(values(['low', 'high'])).toEqual(['off', 'low', 'high'])
  })

  test('a model that reasons at no level still offers "off"', () => {
    expect(values([])).toEqual(['off'])
  })

  test('a producer that publishes nothing gets the whole scale, not an empty one', () => {
    // Absent is "unknown", not "none" — a catalog without the capability must keep working.
    expect(values(undefined)).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})

describe('clampModelReasoning', () => {
  test('a level the model lacks becomes the nearest one above it', () => {
    // The failure this exists for: "minimal" chosen against another model, then a model whose
    // finest level is "low". Thinking slightly more is closer to the intent than thinking less.
    expect(clampModelReasoning('minimal', ['low', 'medium', 'high'])).toBe('low')
  })

  test('falls back downward when nothing above exists', () => {
    expect(clampModelReasoning('max', ['low', 'medium'])).toBe('medium')
  })

  test('a supported level is untouched, and so are "off" and absent', () => {
    expect(clampModelReasoning('high', ['low', 'high'])).toBe('high')
    expect(clampModelReasoning('off', ['low'])).toBe('off')
    expect(clampModelReasoning(undefined, ['low'])).toBeUndefined()
  })

  test('a model that reasons at no level answers "off"', () => {
    expect(clampModelReasoning('high', [])).toBe('off')
  })

  test('an unpublished capability leaves the preference alone', () => {
    expect(clampModelReasoning('minimal', undefined)).toBe('minimal')
  })
})

describe('carriedReasoningEffort', () => {
  test("the session's own level is what a new model inherits", () => {
    expect(carriedReasoningEffort('high', 'low')).toBe('high')
  })

  test('an `off` session does NOT turn every other model off', () => {
    // The bug this pins: one pick of a model that cannot reason put `off` on the session, every
    // row in the picker then read "Off", and each model picked from there had `off` written
    // into its own memory — permanently, and invisibly.
    expect(carriedReasoningEffort('off', 'high')).toBe('high')
  })

  test('with nothing remembered it falls to the default, never to off', () => {
    expect(carriedReasoningEffort('off', null)).toBe(DEFAULT_REASONING_EFFORT)
    expect(carriedReasoningEffort(undefined, null)).toBe(DEFAULT_REASONING_EFFORT)
  })
})
