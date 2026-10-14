import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearOnboardingStep,
  loadOnboardingFurthest,
  loadOnboardingStep,
  saveOnboardingFurthest,
  saveOnboardingStep,
} from './onboardingProgress'

const STEPS = ['welcome', 'provider', 'appearance', 'ready']

/**
 * Minimal sessionStorage stand-in — bun's test env has no DOM by default.
 *
 * `defineProperty`, never a plain assignment: while any DOM suite in this
 * `bun test` process holds a registered happy-dom, `globalThis.sessionStorage`
 * is a READONLY accessor and assigning to it throws before the test body runs.
 */
function install(value: unknown): void {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value,
    configurable: true,
    writable: true,
  })
}

function installStorage(store = new Map<string, string>()) {
  install({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  return store
}

beforeEach(() => installStorage())
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage')
})

describe('onboarding progress persistence', () => {
  test('round-trips a step id back to its index', () => {
    saveOnboardingStep('appearance')
    expect(loadOnboardingStep(STEPS)).toBe(2)
  })

  test('starts over when nothing is stored', () => {
    expect(loadOnboardingStep(STEPS)).toBe(0)
    expect(loadOnboardingFurthest(STEPS)).toBe(0)
  })

  /**
   * The whole reason ids replaced indexes: a value written by a build with a
   * different registry must not resume on an unrelated step (for the OAuth
   * return that means landing away from Provider and dropping the sign-in).
   */
  test('falls back to the first step for an unknown id — including a legacy index', () => {
    saveOnboardingStep('channels')
    expect(loadOnboardingStep(STEPS)).toBe(0)
    saveOnboardingStep('2')
    expect(loadOnboardingStep(STEPS)).toBe(0)
  })

  test('resolves a step id against the CURRENT order, not a stored position', () => {
    saveOnboardingStep('ready')
    expect(loadOnboardingStep(STEPS)).toBe(3)
    expect(loadOnboardingStep(['ready', 'welcome'])).toBe(0)
  })

  test('furthest is never behind the current step', () => {
    saveOnboardingFurthest('welcome')
    saveOnboardingStep('ready')
    expect(loadOnboardingFurthest(STEPS)).toBe(3)
  })

  test('clear resets both keys so "Replay setup" starts fresh', () => {
    saveOnboardingStep('provider')
    saveOnboardingFurthest('ready')
    clearOnboardingStep()
    expect(loadOnboardingStep(STEPS)).toBe(0)
    expect(loadOnboardingFurthest(STEPS)).toBe(0)
  })

  test('survives an unavailable sessionStorage without throwing', () => {
    install({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveOnboardingStep('provider')).not.toThrow()
    expect(() => clearOnboardingStep()).not.toThrow()
    expect(loadOnboardingStep(STEPS)).toBe(0)
  })
})
