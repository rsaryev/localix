import { describe, expect, test } from 'bun:test'

import { parseTypedConfig } from './config'

describe('parseTypedConfig', () => {
  test('keeps primitive values', () => {
    expect(parseTypedConfig('{"a":"x","b":2,"c":true}')).toEqual({ a: 'x', b: 2, c: true })
  })

  test('drops non-primitive values', () => {
    expect(parseTypedConfig('{"a":"x","nested":{"k":1},"list":[1,2],"nil":null}')).toEqual({
      a: 'x',
    })
  })

  test('returns empty record for malformed JSON', () => {
    expect(parseTypedConfig('not json')).toEqual({})
  })

  test('returns empty record for non-object JSON', () => {
    expect(parseTypedConfig('42')).toEqual({})
    expect(parseTypedConfig('null')).toEqual({})
  })
})
