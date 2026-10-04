import { describe, it, expect } from 'bun:test'
import {
  clientScore,
  searchSettings,
  searchCommands,
  searchUiLocations,
  buildClientGroups,
  mergeClientGroups,
  type SearchCommandEntry,
} from './searchClient'
import { ALL_SCOPE, scopeById } from './scopes'
import { registerUiLocation, unregisterUiLocation } from '@/shared/contrib/uiLocations'

describe('clientScore', () => {
  it('ranks exact > prefix > boundary > mid > subsequence > none', () => {
    const scores = [
      clientScore('theme', 'theme'),
      clientScore('theme preset', 'theme'),
      clientScore('color theme', 'theme'),
      clientScore('atheme', 'theme'),
      clientScore('t-h-e-m-e', 'theme'),
    ]
    expect(scores[0]).toBe(1)
    expect(scores.every((score, index) => index === 0 || scores[index - 1]! > score)).toBe(true)
    expect(clientScore('nope', 'theme')).toBe(0)
  })
})

const cmds: SearchCommandEntry[] = [
  {
    id: 'view.global-search',
    label: 'Global search',
    group: 'Navigation',
    effect: 'read',
    keywords: ['spotlight'],
    run: () => {},
  },
  {
    id: 'view.settings',
    label: 'Open settings',
    group: 'Navigation',
    effect: 'read',
    run: () => {},
  },
  {
    id: 'state.reset',
    label: 'Reset state',
    group: 'Actions',
    effect: 'write',
    run: () => {},
  },
]

describe('searchSettings', () => {
  it('matches title/keyword and mints a canonical Localix settings id', () => {
    const hits = searchSettings('theme')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.domain).toBe('settings')
    expect(hits[0]!.id.startsWith('localix://ui/settings/')).toBe(true)
  })
  it('empty query → no hits', () => expect(searchSettings('')).toEqual([]))
  it('a nonsense query → no hits', () => expect(searchSettings('zzzxqqq')).toEqual([]))
})

describe('searchCommands', () => {
  it('matches label/keyword and mints a canonical Localix command id', () => {
    const hits = searchCommands('spotlight', cmds)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.id).toBe('localix://ui/command/view.global-search')
  })

  it('uses the action namespace for write-classified commands', () => {
    const hits = searchCommands('reset state', cmds)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.id).toBe('localix://ui/action/command/state.reset')
  })
})

describe('searchUiLocations', () => {
  it('returns a directly activatable URI without any screen data', () => {
    const id = 'search-client-fixture.open'
    expect(
      registerUiLocation({
        id,
        uri: 'localix://ui/work-item/search-client-fixture',
        title: 'Fixture workspace',
        keywords: ['surface'],
        effect: 'read',
        surface: 'work-item',
        exposure: { search: true },
        resolve: () => ({
          kind: 'work-item',
          workKind: 'fixture',
          id: 'fixture',
          title: 'Fixture',
        }),
      }),
    ).toBe(true)

    try {
      expect(searchUiLocations('surface')).toEqual([
        {
          id: 'localix://ui/work-item/search-client-fixture',
          domain: 'ui',
          title: 'Fixture workspace',
          subtitle: undefined,
          icon: 'command',
          score: 1,
        },
      ])
    } finally {
      unregisterUiLocation(id)
    }
  })
})

describe('buildClientGroups', () => {
  it('settings only without a command list', () => {
    const groups = buildClientGroups({ query: 'theme' })
    expect(groups.map((g) => g.domain)).toEqual(['settings'])
  })
  it('settings + commands with a list', () => {
    const groups = buildClientGroups({ query: 'settings', commands: cmds })
    expect(groups.some((g) => g.domain === 'commands')).toBe(true)
  })
  it('caps hits to the group limit but keeps the full total', () => {
    const groups = buildClientGroups({ query: 'a', limit: 1 })
    // Anchor: a group is only pushed `if (settings.length)`, so a scoring change that
    // stopped matching 'a' would empty `groups` and leave the loop below asserting
    // nothing at all.
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      expect(g.hits.length).toBeLessThanOrEqual(1)
      // The half the name promises and nothing checked: `total` is the FULL match
      // count, not the capped one — it is what renders "showing 1 of N". Capping it
      // alongside `hits` collapses that to "1 of 1" and no test noticed.
      expect(g.total).toBeGreaterThan(g.hits.length)
    }
  })
})

describe('mergeClientGroups', () => {
  const server = [{ domain: 'sessions', title: 'Chats', hits: [], total: 0 }]
  const client = [{ domain: 'settings', title: 'Settings', hits: [], total: 0 }]
  it('aggregate → server then client', () => {
    expect(mergeClientGroups(ALL_SCOPE, server, client).map((g) => g.domain)).toEqual([
      'sessions',
      'settings',
    ])
  })
  it('a server scope → server only', () => {
    expect(mergeClientGroups(scopeById('sessions')!, server, client).map((g) => g.domain)).toEqual([
      'sessions',
    ])
  })
  it('a client scope → just that client group', () => {
    expect(mergeClientGroups(scopeById('settings')!, server, client).map((g) => g.domain)).toEqual([
      'settings',
    ])
  })
})
