import { describe, expect, it } from 'bun:test'

import { configFieldBase, configPatchValues, mergeConfigValues } from './config-fields'

describe('configFieldBase', () => {
  it('masks secrets: value is always null and isSet only when stored', () => {
    expect(configFieldBase('token', { secret: true }, {})).toEqual({
      key: 'token',
      value: null,
      isSet: false,
    })
    expect(configFieldBase('token', { secret: true }, { token: 'abc' })).toEqual({
      key: 'token',
      value: null,
      isSet: true,
    })
  })

  it('exposes stored non-secret values', () => {
    expect(configFieldBase('host', { secret: false }, { host: 'localhost' })).toEqual({
      key: 'host',
      value: 'localhost',
      isSet: true,
    })
  })

  it('falls back to a non-secret default and counts it as set', () => {
    expect(configFieldBase('port', { default: 8080 }, {})).toEqual({
      key: 'port',
      value: 8080,
      isSet: true,
    })
  })

  it('is unset with null value when neither stored nor defaulted', () => {
    expect(configFieldBase('opt', {}, {})).toEqual({ key: 'opt', value: null, isSet: false })
  })

  it('a stored value wins over the declared default', () => {
    expect(configFieldBase('port', { default: 8080 }, { port: 9090 })).toEqual({
      key: 'port',
      value: 9090,
      isSet: true,
    })
  })
})

describe('mergeConfigValues', () => {
  it('overwrites non-secret values onto the existing config', () => {
    expect(mergeConfigValues({ host: {} }, { host: 'old', keep: 'x' }, { host: 'new' })).toEqual({
      host: 'new',
      keep: 'x',
    })
  })

  it('a blank secret keeps the current value (does not clear it)', () => {
    expect(
      mergeConfigValues({ token: { secret: true } }, { token: 'kept' }, { token: '' }),
    ).toEqual({
      token: 'kept',
    })
  })

  it('a non-empty secret overwrites', () => {
    expect(
      mergeConfigValues({ token: { secret: true } }, { token: 'old' }, { token: 'new' }),
    ).toEqual({
      token: 'new',
    })
  })

  it('a blank NON-secret value is written through (only secrets are protected)', () => {
    expect(mergeConfigValues({ note: {} }, { note: 'old' }, { note: '' })).toEqual({ note: '' })
  })

  it('handles undefined existing config', () => {
    expect(mergeConfigValues({ a: {} }, undefined, { a: 1 })).toEqual({ a: 1 })
  })

  it('returns a fresh object (does not mutate existing)', () => {
    const existing = { a: 1 }
    const out = mergeConfigValues({ b: {} }, existing, { b: 2 })
    expect(out).toEqual({ a: 1, b: 2 })
    expect(existing).toEqual({ a: 1 })
  })
})

describe('configPatchValues', () => {
  it('omits blank secrets but preserves all other falsy primitives', () => {
    expect(
      configPatchValues(
        { secret: { secret: true }, text: {}, enabled: {}, count: {} },
        { secret: '', text: '', enabled: false, count: 0 },
      ),
    ).toEqual({ text: '', enabled: false, count: 0 })
  })
})
