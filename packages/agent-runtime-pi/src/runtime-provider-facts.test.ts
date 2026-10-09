import { expect, test } from 'bun:test'
import { attachProviderResponse, providerResponseOf } from '@localixai/agent/agents'
import { failedWithProviderFacts } from './runtime-provider-facts'

test('a remembered refusal restores response facts without replacing the error', () => {
  const error = new Error('flattened failure')
  expect(failedWithProviderFacts(error, { status: 429, headers: { 'Retry-After': '17' } })).toBe(
    error,
  )
  expect(providerResponseOf(error)).toEqual({ status: 429, headers: { 'retry-after': '17' } })
  expect(Object.keys(error)).toEqual([])
})

test('response facts already on the error take precedence over the last refusal', () => {
  const error = attachProviderResponse(new Error('own response'), {
    status: 503,
    headers: { 'retry-after': '2' },
  })
  const response = providerResponseOf(error)
  expect(failedWithProviderFacts(error, { status: 429, headers: { 'retry-after': '17' } })).toBe(
    error,
  )
  expect(providerResponseOf(error)).toBe(response)
  expect(failedWithProviderFacts(error, undefined)).toBe(error)
})

test('an error without a remembered refusal remains untouched', () => {
  const error = new Error('local failure')
  expect(failedWithProviderFacts(error, undefined)).toBe(error)
  expect(providerResponseOf(error)).toBeUndefined()
})
