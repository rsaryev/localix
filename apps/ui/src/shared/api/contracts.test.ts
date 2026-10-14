import { describe, expect, test } from 'bun:test'
import { isModelConfigField } from './contracts'

describe('isModelConfigField', () => {
  test('explicit type: "model" is a model field', () => {
    expect(isModelConfigField({ key: 'anything', type: 'model' })).toBe(true)
  })

  test('a key ending in _model is a model field (fallback until the backend ships the type)', () => {
    expect(isModelConfigField({ key: 'executor_model' })).toBe(true)
    expect(isModelConfigField({ key: 'default_model', type: 'string' })).toBe(true)
  })

  test('anything else is not a model field', () => {
    expect(isModelConfigField({ key: 'api_key', type: 'string' })).toBe(false)
    expect(isModelConfigField({ key: 'model_name' })).toBe(false) // contains but does not END WITH _model
    expect(isModelConfigField({ key: 'temperature' })).toBe(false)
  })
})
