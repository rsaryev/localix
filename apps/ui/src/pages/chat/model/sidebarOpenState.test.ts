import { describe, expect, test } from 'bun:test'
import { initialSidebarOpen, rememberSidebarOpen } from './sidebarOpenState'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('sidebar open state', () => {
  test('a first run with no stored state starts collapsed', () => {
    expect(initialSidebarOpen(false, memoryStorage())).toBe(false)
  })

  test('an explicit open is remembered and restored on the next launch', () => {
    const storage = memoryStorage()
    rememberSidebarOpen(true, storage)
    expect(initialSidebarOpen(false, storage)).toBe(true)
    rememberSidebarOpen(false, storage)
    expect(initialSidebarOpen(false, storage)).toBe(false)
  })

  test('mobile never reopens the overlay sidebar on load', () => {
    const storage = memoryStorage()
    rememberSidebarOpen(true, storage)
    expect(initialSidebarOpen(true, storage)).toBe(false)
  })
})
