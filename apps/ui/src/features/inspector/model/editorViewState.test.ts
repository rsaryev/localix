import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  editorViewKey,
  getViewState,
  loadEditorViewState,
  MAX_VIEW_STATES,
  putViewState,
  saveEditorViewState,
  type ViewStateStore,
} from './editorViewState'

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
  // `defineProperty`, not assignment: once any suite in this `bun test` process has
  // registered a DOM, `globalThis.localStorage` exists as a READONLY accessor and a
  // plain assignment throws "Attempted to assign to readonly property".
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })
  return map
}

afterEach(() => {
  // Same reason: `delete` cannot remove a non-configurable DOM-provided property, and
  // leaving ours behind would hand the next file a stub instead of its own storage.
  Reflect.deleteProperty(globalThis, 'localStorage')
})

const EMPTY: ViewStateStore = { states: {}, order: [] }

describe('editorViewKey', () => {
  test('scopes by session, falling back to _ when session-less', () => {
    expect(editorViewKey('s1', '/a.ts')).toBe('s1::/a.ts')
    expect(editorViewKey(null, '/a.ts')).toBe('_::/a.ts')
  })
})

describe('putViewState / getViewState (pure)', () => {
  test('stores and reads a snapshot', () => {
    const s = putViewState(EMPTY, 'k', { line: 3, column: 2, top: 1 })
    expect(getViewState(s, 'k')).toEqual({ line: 3, column: 2, top: 1 })
    expect(getViewState(s, 'missing')).toBeNull()
  })

  test('overwrites in place and moves the key to the MRU front', () => {
    let s = putViewState(EMPTY, 'a', { line: 1, column: 0, top: 1 })
    s = putViewState(s, 'b', { line: 2, column: 0, top: 1 })
    s = putViewState(s, 'a', { line: 9, column: 0, top: 1 })
    expect(s.order[0]).toBe('a')
    expect(getViewState(s, 'a')?.line).toBe(9)
  })

  test('evicts the least-recently-used beyond the cap', () => {
    let s = EMPTY
    for (let i = 0; i < MAX_VIEW_STATES + 5; i++) {
      s = putViewState(s, `k${i}`, { line: i + 1, column: 0, top: 1 })
    }
    expect(s.order.length).toBe(MAX_VIEW_STATES)
    // The 5 oldest are gone; the newest remains.
    expect(getViewState(s, 'k0')).toBeNull()
    expect(getViewState(s, `k${MAX_VIEW_STATES + 4}`)).not.toBeNull()
  })
})

describe('persistence round-trip', () => {
  beforeEach(() => installStorage())

  test('save + load a file snapshot', () => {
    const key = editorViewKey('s1', '/x.ts')
    expect(loadEditorViewState(key)).toBeNull()
    saveEditorViewState(key, { line: 42, column: 4, top: 30 })
    expect(loadEditorViewState(key)).toEqual({ line: 42, column: 4, top: 30 })
  })

  test('tolerates corrupt storage', () => {
    localStorage.setItem('localix_editor_view_state', 'nope')
    expect(loadEditorViewState('any')).toBeNull()
  })
})
