import { describe, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'

import { createListingIndex } from './listing-index'

const chess = makeListing({
  id: 'chess',
  displayName: 'Chess',
  summary: 'Legal moves and an agent opponent',
  category: 'games',
  tags: ['board-game', 'strategy'],
  featured: true,
  contents: { screen: 1, command: 2 },
})
const kanban = makeListing({
  id: 'kanban',
  displayName: 'Kanban',
  summary: 'Cards for the work in a project',
  category: 'utilities',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
  source: { id: 'https://ada.test/c.json', label: 'ada.test' },
})
const review = makeListing({
  id: 'review',
  kind: 'plugin',
  displayName: 'Code review',
  summary: 'Reviews a diff',
  contents: { skill: 3 },
  componentNames: ['pr-review', 'security-audit'],
})

const index = createListingIndex([chess, kanban, review])
const ids = (listings: { ref: { id: string } }[]) => listings.map((listing) => listing.ref.id)

describe('the Store index', () => {
  test('finds a listing by its ref', () => {
    expect(index.get({ kind: 'mini-app', id: 'chess' })?.displayName).toBe('Chess')
    expect(index.get({ kind: 'plugin', id: 'chess' })).toBeUndefined()
  })

  test('a shelf holds its kind, its capability or the library', () => {
    expect(ids(index.query({ shelf: 'package:mini-app' }))).toEqual(['chess', 'kanban'])
    expect(ids(index.query({ shelf: 'capability:skill' }))).toEqual(['review'])
    expect(ids(index.query({ shelf: 'discover' }))).toEqual(['chess'])
    expect(ids(index.query({ shelf: 'updates' }))).toEqual(['kanban'])
    expect(ids(index.query({ installed: false }))).toEqual(['chess', 'review'])
  })

  test('search matches every word, in names, summaries, tags and component names', () => {
    expect(ids(index.query({ q: 'board' }))).toEqual(['chess'])
    expect(ids(index.query({ q: 'agent opp' }))).toEqual(['chess'])
    expect(ids(index.query({ q: 'KANB' }))).toEqual(['kanban'])
    expect(ids(index.query({ q: 'security' }))).toEqual(['review'])
    expect(ids(index.query({ q: 'chess cards' }))).toEqual([])
  })

  test('a scope keeps only what is installed there', () => {
    expect(ids(index.query({ scope: 'user' }))).toEqual(['kanban'])
    expect(ids(index.query({ scope: 'project' }))).toEqual([])
  })

  test('facets count every listing, whatever the query', () => {
    expect(index.facets()).toEqual({
      shelves: {
        discover: 1,
        'package:mini-app': 2,
        'package:plugin': 1,
        'capability:skill': 1,
        'capability:command': 1,
        'capability:screen': 1,
        installed: 1,
        updates: 1,
      },
      kind: { 'mini-app': 2, plugin: 1 },
      component: { skill: 1, command: 1, screen: 1 },
      category: { games: 1, utilities: 1 },
      source: { 'https://hosted.test/catalog.json': 2, 'https://ada.test/c.json': 1 },
      installed: 1,
      updates: 1,
    })
  })
})
