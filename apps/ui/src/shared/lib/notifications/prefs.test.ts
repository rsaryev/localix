import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const KEY = 'localix_notification_prefs_v1'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const originalStorage = globalThis.localStorage

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalStorage,
  })
})

async function freshPrefs() {
  return import(`./prefs?test=${Math.random()}`)
}

describe('notification preferences persistence', () => {
  it('persists the centralized condition and terminal method in the existing key', async () => {
    const { useNotificationPrefs } = await freshPrefs()
    useNotificationPrefs.getState().setCondition('always')
    useNotificationPrefs.getState().setTerminalMethod('osc9')

    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
      schemaVersion: 2,
      condition: 'always',
      terminalMethod: 'osc9',
      appIconBadge: true,
    })
  })
})
