import { describe, expect, test } from 'bun:test'
import {
  MINI_APP_CONTEXT_MAX_TIMEOUT_MS,
  MINI_APP_CONTEXT_MAX_TOKENS,
  validateContextContribution,
} from './contribution-validate'
import type {
  AutomaticContextProvider,
  ContextProviderContribution,
  ContextResolver,
} from './contracts'

const resolver: ContextResolver = {
  id: 'files',
  version: '1',
  supports: () => true,
  estimate: async () => ({ bytes: 0 }),
  resolve: async () => [],
}

const base: ContextProviderContribution = {
  provider: resolver,
  destinations: ['chat'],
  activation: 'explicit',
  defaultEnabled: true,
  maxTokens: 100,
  timeoutMs: 100,
  sensitivity: 'project',
}

describe('validateContextContribution', () => {
  test('accepts a well-formed explicit resolver', () => {
    expect(validateContextContribution(base).ok).toBe(true)
  })

  test('rejects an unknown destination', () => {
    const result = validateContextContribution({ ...base, destinations: ['nope' as never] })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_metadata' })
  })

  test('rejects a token budget over the mini app ceiling', () => {
    const result = validateContextContribution({
      ...base,
      maxTokens: MINI_APP_CONTEXT_MAX_TOKENS + 1,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_metadata' })
  })

  test('rejects a timeout over the mini app ceiling', () => {
    const result = validateContextContribution({
      ...base,
      timeoutMs: MINI_APP_CONTEXT_MAX_TIMEOUT_MS + 1,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_metadata' })
  })

  test('rejects a declared sensitivity of forbidden', () => {
    const result = validateContextContribution({ ...base, sensitivity: 'forbidden' as never })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_metadata' })
  })

  test('rejects a provider missing required functions', () => {
    const result = validateContextContribution({
      ...base,
      provider: { id: 'x', version: '1' } as never,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_provider_shape' })
  })

  test('rejects an automatic declaration that widens provider destinations', () => {
    const provider: AutomaticContextProvider = {
      id: 'auto',
      version: '1',
      destinations: ['edit-prediction'],
      sensitivity: 'project',
      provide: async () => [],
    }
    const result = validateContextContribution({
      ...base,
      provider,
      activation: 'automatic',
      destinations: ['chat'],
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_destinations' })
  })

  test('rejects an automatic declaration that escalates sensitivity above the provider', () => {
    const provider: AutomaticContextProvider = {
      id: 'auto',
      version: '1',
      destinations: ['edit-prediction'],
      sensitivity: 'public',
      provide: async () => [],
    }
    const result = validateContextContribution({
      ...base,
      provider,
      activation: 'automatic',
      destinations: ['edit-prediction'],
      sensitivity: 'sensitive',
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_sensitivity' })
  })
})
