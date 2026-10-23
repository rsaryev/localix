import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_RAIL_RECENTS_MODE,
  getRailRecentsMode,
  parseRailRecentsMode,
  setRailRecentsMode,
} from './railRecentsPref'

describe('railRecentsPref', () => {
  test('a foreign or absent persisted value falls back to the quiet default', () => {
    expect(parseRailRecentsMode(null)).toBe(DEFAULT_RAIL_RECENTS_MODE)
    expect(parseRailRecentsMode('')).toBe(DEFAULT_RAIL_RECENTS_MODE)
    expect(parseRailRecentsMode('collapsed')).toBe(DEFAULT_RAIL_RECENTS_MODE)
  })

  test('every real mode round-trips', () => {
    expect(parseRailRecentsMode('hover')).toBe('hover')
    expect(parseRailRecentsMode('expanded')).toBe('expanded')
    expect(parseRailRecentsMode('off')).toBe('off')
  })

  test('setting a mode notifies readers and returns to the default cleanly', () => {
    try {
      setRailRecentsMode('off')
      expect(getRailRecentsMode()).toBe('off')
      setRailRecentsMode('expanded')
      expect(getRailRecentsMode()).toBe('expanded')
    } finally {
      setRailRecentsMode(DEFAULT_RAIL_RECENTS_MODE)
    }
    expect(getRailRecentsMode()).toBe(DEFAULT_RAIL_RECENTS_MODE)
  })
})
