import { afterEach, beforeEach, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'
import { loadLocalSettings } from './userSettings'

beforeEach(() => {
  const values = new Map<string, string>()
  installTestLocalStorage({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
})
afterEach(() => removeTestLocalStorage())

test('retired personal data is removed from memory and cache without losing settings', () => {
  const cacheKey = 'localix_user_settings_v2'
  localStorage.setItem(
    cacheKey,
    JSON.stringify({
      displayName: 'Old name',
      primaryRole: 'developer',
      responsePreferences: 'Concise',
      experienceLevel: 'senior',
      mainUseCase: 'write-code',
      workingContext: 'Old context',
      uiSettings: { fontSize: 'lg' },
      agentSettings: { maxTurns: 25 },
    }),
  )
  const expected = { uiSettings: { fontSize: 'lg' as const }, agentSettings: { maxTurns: 25 } }
  expect(loadLocalSettings()).toEqual(expected)
  expect(JSON.parse(localStorage.getItem(cacheKey)!)).toEqual(expected)
})
