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

  test('Skills, Agents and MCP servers are one shelf each: standalone ones and those inside packages', () => {
    const mine = makeListing({ id: 'review', kind: 'skill', contents: { skill: 1 } })
    const plugin = makeListing({ id: 'lint', kind: 'plugin', contents: { skill: 3, agent: 1 } })
    expect(onShelf(mine, 'capability:skill')).toBe(true)
    expect(onShelf(plugin, 'capability:skill')).toBe(true)
    expect(shelfCounts([mine, plugin, chess])).toMatchObject({
      'capability:skill': 4,
      'capability:agent': 1,
    })
    const shelves: readonly string[] = SHELVES
    for (const kind of ['skill', 'agent', 'mcp-server']) {
      expect(shelves).not.toContain(`package:${kind}`)
      expect(shelves).toContain(`capability:${kind}`)
    }
    expect(Object.keys(shelfCounts([mine]))).toEqual(['capability:skill'])
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
      'capability:command': 2,
      installed: 1,
      updates: 1,
    })
  })

  test('a capability shelf counts what it lists: components, not the packages holding them', () => {
    const three = makeListing({ id: 'git', contents: { command: 3 } })
    expect(shelfCounts([three, chess])['capability:command']).toBe(5)
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

  test('what a person or a project wrote is on Yours or Project, installed or not', () => {
    const mine = makeListing({ id: 'review', kind: 'skill', authored: 'user' })
    const ours = makeListing({ id: 'deploy', kind: 'skill', authored: 'project' })
    expect(onShelf(mine, 'yours')).toBe(true)
    expect(onShelf(mine, 'project')).toBe(false)
    expect(onShelf(ours, 'project')).toBe(true)
    expect(onShelf(chess, 'yours')).toBe(false)
    expect(shelfCounts([mine, ours, chess])).toMatchObject({ yours: 1, project: 1 })
    expect(parseShelf('yours')).toBe('yours')
    expect(parseShelf('project')).toBe('project')
  })

  test('Installed is what came from a source; what you wrote and what comes with Localix or a plugin is not on it', () => {
    const installed = [{ scope: 'user' as const, enabled: true }]
    const fetched = makeListing({ id: 'lint', kind: 'plugin', installs: installed })
    const mine = makeListing({ id: 'review', kind: 'skill', authored: 'user', installs: installed })
    const ours = makeListing({
      id: 'deploy',
      kind: 'skill',
      authored: 'project',
      installs: installed,
    })
    const bundled = makeListing({
      id: 'builtin:Plan',
      kind: 'agent',
      bundled: true,
      installs: installed,
    })
    for (const listing of [mine, ours, bundled]) expect(onShelf(listing, 'installed')).toBe(false)
    expect(onShelf(fetched, 'installed')).toBe(true)
    expect(shelfCounts([fetched, mine, ours, bundled])).toMatchObject({ installed: 1, yours: 1 })
  })

  test('a shelf id from outside is taken only when it names a shelf', () => {
    expect(parseShelf('package:mini-app')).toBe('package:mini-app')
    expect(parseShelf('capability:mod')).toBe('capability:mod')
    expect(parseShelf('package:theme')).toBeNull()
    expect(parseShelf(undefined)).toBeNull()
  })

  test('a listing says how far its source is trusted, where it comes from and where else it is', () => {
    const listing = makeListing({
      id: 'lint',
      kind: 'plugin',
      source: { id: 'claude-plugins-official', label: 'Claude plugins', trust: 'official' },
      origin: 'git:github.com/acme/lint',
      alsoIn: [{ id: 'claude-plugins-community', label: 'Claude community' }],
      homepage: 'https://acme.test',
    })
    expect(listingSchema.parse(listing)).toEqual(listing)
    expect(() =>
      listingSchema.parse({ ...listing, source: { ...listing.source, trust: 'friends' } }),
    ).toThrow()
  })

  test('a listing whose contents are not known yet still parses', () => {
    expect(listingSchema.parse(remote).contents).toBe('unknown')
    expect(() => listingSchema.parse({ ...chess, contents: { gadget: 1 } })).toThrow()
  })
})
