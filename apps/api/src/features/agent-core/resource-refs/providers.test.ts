import { describe, expect, test } from 'bun:test'
import { RESOURCE_PROVIDERS } from './providers'

describe('host resource provider ids', () => {
  test('the host catalog contains host-owned domains only', () => {
    expect(RESOURCE_PROVIDERS).toEqual({
      capability: 'capability',
      chat: 'chat',
      git: 'git',
      vault: 'vault',
    })
  })

  test('host provider ids are unique', () => {
    const values = Object.values(RESOURCE_PROVIDERS)
    expect(new Set(values).size).toBe(values.length)
  })
})
