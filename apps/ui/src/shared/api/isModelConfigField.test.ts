import { describe, expect, test } from 'bun:test'
import { isModelConfigField } from './contracts'

describe('isModelConfigField', () => {
  test('an explicit type: "model" field is a model picker (whatever the key)', () => {
    expect(isModelConfigField({ key: 'anything', type: 'model' })).toBe(true)
    expect(isModelConfigField({ key: 'foo', type: 'model' })).toBe(true)
  })

  test('a key ending in _model is the fallback heuristic', () => {
    expect(isModelConfigField({ key: 'executor_model' })).toBe(true)
    expect(isModelConfigField({ key: 'reviewer_model', type: 'string' })).toBe(true)
  })

  test('other fields are not model pickers', () => {
    expect(isModelConfigField({ key: 'api_key', type: 'string' })).toBe(false)
    expect(isModelConfigField({ key: 'model_name' })).toBe(false) // contains, but does not END with _model
    expect(isModelConfigField({ key: 'temperature' })).toBe(false)
  })
})
