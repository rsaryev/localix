import { describe, expect, spyOn, test } from 'bun:test'

import { loadJSON, loadString, saveJSON, saveString } from './storage'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('plugin UI storage helpers', () => {
  test('round-trips strings and JSON through an injected store', () => {
    const storage = memoryStorage()

    saveString('name', 'localix', storage)
    saveJSON('settings', { compact: true }, storage)

    expect(loadString('name', storage)).toBe('localix')
    expect(loadJSON<{ compact: boolean }>('settings', storage)).toEqual({
      compact: true,
    })
  })

  test('removes nullish values', () => {
    const storage = memoryStorage()
    saveString('string', 'value', storage)
    saveJSON('json', { value: true }, storage)

    saveString('string', null, storage)
    saveJSON('json', undefined, storage)

    expect(loadString('string', storage)).toBeNull()
    expect(loadJSON('json', storage)).toBeNull()
  })

  test('degrades safely when storage is unavailable or malformed', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    const malformed = { getItem: () => '{' }

    expect(loadString('key', unavailable)).toBeNull()
    expect(loadJSON('key', unavailable)).toBeNull()
    expect(loadJSON('key', malformed)).toBeNull()
    expect(() => saveString('key', 'value', unavailable)).not.toThrow()
    expect(() => saveJSON('key', { value: true }, unavailable)).not.toThrow()
  })

  test('a full store is reported once per key, not swallowed', () => {
    const full = {
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      saveJSON('quota-report-grid', { a: 1 }, full)
      saveJSON('quota-report-grid', { a: 2 }, full)
      saveString('quota-report-draft', 'x', full)
      const reported = warn.mock.calls.map((call) => String(call[0]))
      expect(reported.filter((line) => line.includes('quota-report-grid'))).toHaveLength(1)
      expect(reported.filter((line) => line.includes('quota-report-draft'))).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})
