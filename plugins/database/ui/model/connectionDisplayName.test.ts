import { describe, expect, test } from 'bun:test'
import { connectionDisplayName } from './connectionDisplayName'

describe('connectionDisplayName', () => {
  test('hides the legacy SQLite driver sentinel', () => {
    expect(connectionDisplayName({ dialect: 'sqlite', name: ':memory:' })).toBe('In-memory SQLite')
    expect(connectionDisplayName({ dialect: 'sqlite', name: ':memory' })).toBe('In-memory SQLite')
    expect(connectionDisplayName({ dialect: 'sqlite', name: ':inmemory' })).toBe('In-memory SQLite')
  })

  test('preserves user-facing names', () => {
    expect(connectionDisplayName({ dialect: 'sqlite', name: 'Scratch DB' })).toBe('Scratch DB')
    expect(connectionDisplayName({ dialect: 'postgres', name: ':memory:' })).toBe(':memory:')
  })
})
