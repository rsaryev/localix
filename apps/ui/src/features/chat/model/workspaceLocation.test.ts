import { beforeEach, describe, expect, test } from 'bun:test'

import {
  loadLocations,
  loadScopeLocation,
  locationForScope,
  rememberScopeSection,
  rememberScopeSidebarOpen,
  withScopeLocation,
} from './workspaceLocation'

// Map-backed localStorage stand-in (Bun has no DOM storage).
function installStorage() {
  const map = new Map<string, string>()
  const store: Storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  return store
}

describe('withScopeLocation (pure)', () => {
  test('merges a partial patch, leaving untouched fields', () => {
    const m0 = withScopeLocation({}, 'p1', { section: 'files' })
    expect(locationForScope(m0, 'p1')).toEqual({ section: 'files', sidebarOpen: null })
    const m1 = withScopeLocation(m0, 'p1', { sidebarOpen: true })
    expect(locationForScope(m1, 'p1')).toEqual({ section: 'files', sidebarOpen: true })
  })

  test('is a no-op (same ref) when nothing changes', () => {
    const m0 = withScopeLocation({}, 'p1', { section: 'jobs' })
    expect(withScopeLocation(m0, 'p1', { section: 'jobs' })).toBe(m0)
  })

  test('keys each project separately', () => {
    let m = withScopeLocation({}, 'p2', { section: 'jobs' })
    m = withScopeLocation(m, 'p1', { section: 'files' })
    expect(locationForScope(m, 'p2').section).toBe('jobs')
    expect(locationForScope(m, 'p1').section).toBe('files')
  })

  test('an unresolved scope remembers nothing and writes nothing', () => {
    // `null` is the frame before a project is known, not a place with its own memory:
    // writing there used to mint a `__global__` entry nothing could ever read back.
    const m0 = withScopeLocation({}, 'p1', { section: 'files' })
    expect(withScopeLocation(m0, null, { section: 'jobs' })).toBe(m0)
    expect(locationForScope(m0, null).section).toBeNull()
  })

  test('section:null explicitly clears a remembered section', () => {
    const m0 = withScopeLocation({}, 'p1', { section: 'files' })
    const m1 = withScopeLocation(m0, 'p1', { section: null })
    expect(locationForScope(m1, 'p1').section).toBeNull()
  })
})

describe('locationForScope (pure)', () => {
  test('returns an empty location for an unknown scope', () => {
    expect(locationForScope({}, 'nope')).toEqual({ section: null, sidebarOpen: null })
  })
})

describe('persistence round-trip', () => {
  let storage: Storage

  beforeEach(() => {
    storage = installStorage()
  })

  test('section + sidebar persist and reload per scope', () => {
    expect(loadScopeLocation('p1', storage)).toEqual({ section: null, sidebarOpen: null })
    rememberScopeSection('p1', 'files', storage)
    rememberScopeSidebarOpen('p1', true, storage)
    rememberScopeSection('p2', 'jobs', storage)
    expect(loadScopeLocation('p1', storage)).toEqual({ section: 'files', sidebarOpen: true })
    expect(loadScopeLocation('p2', storage).section).toBe('jobs')
  })

  test('tolerates corrupt storage', () => {
    storage.setItem('localix_workspace_location', '{ not json')
    expect(loadLocations(storage)).toEqual({})
  })

  test('drops an unknown section value on read', () => {
    storage.setItem(
      'localix_workspace_location',
      JSON.stringify({ p1: { section: 'bogus', sidebarOpen: 'yes' } }),
    )
    expect(loadScopeLocation('p1', storage)).toEqual({ section: null, sidebarOpen: null })
  })
})
