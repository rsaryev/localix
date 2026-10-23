import { describe, expect, it } from 'bun:test'
import {
  MAX_RAIL_RECENTS,
  emptyRailRecents,
  parseRailRecents,
  removeRecent,
  resolveRecents,
  serializeRailRecents,
  touchRecent,
} from './railRecents'

const known = (...ids: string[]) => new Set(ids)
const pinned = (...ids: string[]) => new Set(ids)

describe('touchRecent', () => {
  it('puts a freshly opened entry at the front', () => {
    const state = touchRecent(touchRecent(emptyRailRecents(), 'view:a'), 'view:b')
    expect(state.ids).toEqual(['view:b', 'view:a'])
  })

  it('re-opening an entry moves it back to the front instead of duplicating it', () => {
    let state = emptyRailRecents()
    for (const id of ['view:a', 'view:b', 'view:a']) state = touchRecent(state, id)
    expect(state.ids).toEqual(['view:a', 'view:b'])
  })

  it('caps the list, evicting the oldest entry', () => {
    // One past the cap, whatever the cap is: newest first, oldest gone.
    const opened = Array.from({ length: MAX_RAIL_RECENTS + 1 }, (_, i) => `view:${i}`)
    let state = emptyRailRecents()
    for (const id of opened) state = touchRecent(state, id)
    expect(state.ids).toHaveLength(MAX_RAIL_RECENTS)
    expect(state.ids).toEqual([...opened].reverse().slice(0, MAX_RAIL_RECENTS))
    expect(state.ids).not.toContain('view:0')
  })

  it('accepts a null state (nothing persisted yet)', () => {
    expect(touchRecent(null, 'view:a').ids).toEqual(['view:a'])
  })
})

describe('removeRecent', () => {
  it('drops the id so a pinned entry cannot squat an MRU slot', () => {
    const state = touchRecent(touchRecent(emptyRailRecents(), 'view:a'), 'view:b')
    expect(removeRecent(state, 'view:b').ids).toEqual(['view:a'])
  })

  it('is a no-op for an id that was never opened', () => {
    const state = touchRecent(emptyRailRecents(), 'view:a')
    expect(removeRecent(state, 'view:zz').ids).toEqual(['view:a'])
  })
})

describe('resolveRecents', () => {
  it('renders recency order', () => {
    let state = emptyRailRecents()
    for (const id of ['view:a', 'view:b']) state = touchRecent(state, id)
    expect(resolveRecents(state, known('view:a', 'view:b'), pinned())).toEqual(['view:b', 'view:a'])
  })

  it('hides a pinned entry — it already has a permanent slot — but keeps it in state', () => {
    let state = emptyRailRecents()
    for (const id of ['view:a', 'view:b']) state = touchRecent(state, id)
    expect(resolveRecents(state, known('view:a', 'view:b'), pinned('view:b'))).toEqual(['view:a'])
    expect(state.ids).toEqual(['view:b', 'view:a'])
  })

  it('hides an entry whose mini app is disabled, and restores it when the mini app returns', () => {
    const state = touchRecent(emptyRailRecents(), 'view:gone')
    expect(resolveRecents(state, known(), pinned())).toEqual([])
    expect(resolveRecents(state, known('view:gone'), pinned())).toEqual(['view:gone'])
  })

  it('tolerates a null state', () => {
    expect(resolveRecents(null, known('view:a'), pinned())).toEqual([])
  })

  it('survives a pin/unpin round trip: unpinning floats the entry back to the front', () => {
    let state = touchRecent(touchRecent(emptyRailRecents(), 'view:a'), 'view:b')
    state = removeRecent(state, 'view:b') // pinned
    expect(resolveRecents(state, known('view:a', 'view:b'), pinned('view:b'))).toEqual(['view:a'])
    state = touchRecent(state, 'view:b') // unpinned again
    expect(resolveRecents(state, known('view:a', 'view:b'), pinned())).toEqual(['view:b', 'view:a'])
  })
})

describe('parse / serialize', () => {
  it('round-trips through storage', () => {
    const state = touchRecent(touchRecent(emptyRailRecents(), 'view:a'), 'view:b')
    expect(parseRailRecents(serializeRailRecents(state))).toEqual(state)
  })

  it('yields null for absent, malformed, or foreign values', () => {
    expect(parseRailRecents(null)).toBeNull()
    expect(parseRailRecents('')).toBeNull()
    expect(parseRailRecents('{ not json')).toBeNull()
    expect(parseRailRecents('42')).toBeNull()
    expect(parseRailRecents('{"entries":[{"id":"view:a"}]}')).toBeNull()
  })

  it('reads a payload regardless of its version stamp, dropping junk ids', () => {
    const parsed = parseRailRecents('{"v":99,"ids":["view:a",7,"","view:a","view:b"]}')
    expect(parsed?.ids).toEqual(['view:a', 'view:b'])
  })

  it('clamps an over-long persisted list to the cap', () => {
    const ids = Array.from({ length: MAX_RAIL_RECENTS + 2 }, (_, i) => `view:${i}`)
    const parsed = parseRailRecents(JSON.stringify({ v: 1, ids }))
    expect(parsed?.ids).toHaveLength(MAX_RAIL_RECENTS)
    expect(parsed?.ids).toEqual(ids.slice(0, MAX_RAIL_RECENTS))
  })
})
