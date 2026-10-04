import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_USER_ID,
  defaultDbFile,
  envFlag,
  envInt,
  envString,
  loadEnv,
  resolveDbFile,
  resolveDefaultUserId,
} from './env'

describe('loadEnv', () => {
  test('applies defaults for an empty source', () => {
    const env = loadEnv({})
    expect(env.PORT).toBe(5051)
    expect(env.HOST).toBe('127.0.0.1')
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.LOCALIX_DEFAULT_USER_ID).toBe('local-user')
    expect(env.LOCALIX_DB_FILE).toBe(path.join(os.homedir(), '.localix', 'localix.db'))
    expect(env.LOCALIX_UI_DIR).toBeUndefined()
  })

  test('coerces PORT from a string to a number', () => {
    expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080)
  })

  test('accepts zero for OS-assigned ports and rejects other invalid values', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow()
    expect(loadEnv({ PORT: '0' }).PORT).toBe(0)
    expect(() => loadEnv({ PORT: '-1' })).toThrow()
    expect(() => loadEnv({ PORT: '3.5' })).toThrow()
  })

  test('validates LOG_LEVEL against the enum', () => {
    expect(loadEnv({ LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug')
    expect(() => loadEnv({ LOG_LEVEL: 'trace' })).toThrow()
  })

  test('rejects an empty HOST (min length 1)', () => {
    expect(() => loadEnv({ HOST: '' })).toThrow()
  })

  test('passes through explicit overrides', () => {
    const env = loadEnv({
      HOST: '127.0.0.1',
      LOCALIX_DB_FILE: '/tmp/custom.db',
      LOCALIX_DEFAULT_USER_ID: 'alice',
      LOCALIX_UI_DIR: '/dist',
    })
    expect(env.HOST).toBe('127.0.0.1')
    expect(env.LOCALIX_DB_FILE).toBe('/tmp/custom.db')
    expect(env.LOCALIX_DEFAULT_USER_ID).toBe('alice')
    expect(env.LOCALIX_UI_DIR).toBe('/dist')
  })
})

// The ad-hoc readers share ONE spelling rule: trimmed, and blank means unset.
// Locked down here so a var can never silently mis-parse (an empty `FOO=` used to
// win over the fallback on a raw `??` read).

describe('envFlag', () => {
  test('accepts every truthy/falsy spelling, case-insensitively', () => {
    for (const raw of ['1', 'true', 'YES', ' on '])
      expect(envFlag('F', false, { F: raw })).toBe(true)
    for (const raw of ['0', 'false', 'NO', ' off '])
      expect(envFlag('F', true, { F: raw })).toBe(false)
  })

  test('falls back on a missing, blank, or unrecognized value', () => {
    expect(envFlag('F', true, {})).toBe(true)
    expect(envFlag('F', true, { F: '  ' })).toBe(true)
    expect(envFlag('F', true, { F: 'maybe' })).toBe(true)
    expect(envFlag('F', false, { F: 'maybe' })).toBe(false)
  })
})

describe('envInt', () => {
  test('parses a positive integer and floors a float', () => {
    expect(envInt('N', 7, { N: '42' })).toBe(42)
    expect(envInt('N', 7, { N: ' 42.9 ' })).toBe(42)
  })

  test('falls back on missing, blank, non-numeric, zero, or negative — never NaN', () => {
    for (const source of [{}, { N: '' }, { N: 'abc' }, { N: '0' }, { N: '-5' }]) {
      expect(envInt('N', 7, source)).toBe(7)
    }
  })
})

describe('envString', () => {
  test('trims a set value', () => {
    expect(envString('S', { S: '  /tmp/x  ' })).toBe('/tmp/x')
  })

  test('treats missing and blank alike — undefined, so the caller owns the default', () => {
    expect(envString('S', {})).toBeUndefined()
    expect(envString('S', { S: '   ' })).toBeUndefined()
  })
})

describe('resolveDbFile / resolveDefaultUserId', () => {
  test('return the canonical default when unset or blank', () => {
    expect(resolveDbFile({})).toBe(defaultDbFile())
    expect(resolveDbFile({ LOCALIX_DB_FILE: '  ' })).toBe(defaultDbFile())
    expect(resolveDefaultUserId({})).toBe(DEFAULT_USER_ID)
    expect(resolveDefaultUserId({ LOCALIX_DEFAULT_USER_ID: '  ' })).toBe(DEFAULT_USER_ID)
  })

  test('return the trimmed override when set', () => {
    expect(resolveDbFile({ LOCALIX_DB_FILE: ' /tmp/c.db ' })).toBe('/tmp/c.db')
    expect(resolveDefaultUserId({ LOCALIX_DEFAULT_USER_ID: ' alice ' })).toBe('alice')
  })

  test('agree with loadEnv on the same source (one owner for each default)', () => {
    expect(resolveDbFile({})).toBe(loadEnv({}).LOCALIX_DB_FILE)
    expect(resolveDefaultUserId({})).toBe(loadEnv({}).LOCALIX_DEFAULT_USER_ID)
  })
})
