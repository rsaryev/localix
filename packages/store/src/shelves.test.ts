import { describe, expect, test } from 'bun:test'

import { listingSchema } from './contract'
import { SHELVES, onShelf, parseShelf, shelfCounts } from './shelves'
import { makeListing } from './testing'

const chess = makeListing({
  id: 'chess',
  featured: true,
  contents: { screen: 1, command: 2 },
})
const notes = makeListing({
  id: 'notes',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})
const remote = makeListing({ id: 'remote', kind: 'plugin', contents: 'unknown' })

describe('shelves', () => {
  test('a listing is on its kind’s shelf and on one shelf per component it contains', () => {
    expect(onShelf(chess, 'package:mini-app')).toBe(true)
    expect(onShelf(chess, 'package:plugin')).toBe(false)
    expect(onShelf(chess, 'capability:command')).toBe(true)
    expect(onShelf(chess, 'capability:skill')).toBe(false)
    expect(onShelf(remote, 'capability:skill')).toBe(false)
  })

  test('Discover holds featured and recommended packages; the library holds installs and updates', () => {
    expect(onShelf(chess, 'discover')).toBe(true)
    expect(onShelf(notes, 'discover')).toBe(false)
    expect(onShelf(notes, 'installed')).toBe(true)
    expect(onShelf(notes, 'updates')).toBe(true)
    expect(onShelf({ ...notes, incompatible: 'needs a newer Localix' }, 'updates')).toBe(false)
  })

  test('an empty shelf is left out of the counts', () => {
    expect(shelfCounts([chess, notes, remote])).toEqual({
      discover: 1,
      'package:mini-app': 2,
      'package:plugin': 1,
      'capability:command': 1,
      installed: 1,
      updates: 1,
    })
  })

  test('a package’s own machinery — its screen, backend, agent tools — is never a shelf', () => {
    const app = makeListing({
      id: 'board',
      contents: { screen: 1, backend: 1, 'agent-tool': 1, skill: 2 },
    })
    expect(Object.keys(shelfCounts([app]))).toEqual(['package:mini-app', 'capability:skill'])
    for (const kind of ['screen', 'backend', 'agent-tool']) {
      expect(parseShelf(`capability:${kind}`)).toBeNull()
      expect(SHELVES).not.toContain(`capability:${kind}`)
    }
    expect(SHELVES).toContain('capability:output-style')
  })

  test('a shelf id from outside is taken only when it names a shelf', () => {
    expect(parseShelf('package:mini-app')).toBe('package:mini-app')
    expect(parseShelf('capability:mod')).toBe('capability:mod')
    expect(parseShelf('package:theme')).toBeNull()
    expect(parseShelf(undefined)).toBeNull()
  })

  test('a listing whose contents are not known yet still parses', () => {
    expect(listingSchema.parse(remote).contents).toBe('unknown')
    expect(() => listingSchema.parse({ ...chess, contents: { gadget: 1 } })).toThrow()
  })
})
