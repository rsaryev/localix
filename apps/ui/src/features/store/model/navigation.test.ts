import { describe, expect, test } from 'bun:test'
import type { StoreFacets } from '@localixai/store'

import { navGroups, sectionLabel } from './navigation'

const facets = (shelves: StoreFacets['shelves']) =>
  ({
    shelves,
    kind: {},
    component: {},
    category: {},
    source: {},
    installed: 0,
    updates: 0,
  }) as StoreFacets

const library = (shelves: StoreFacets['shelves']) =>
  navGroups(facets(shelves)).find((group) => group.id === 'library')!.items

describe('the Store navigation', () => {
  test('Yours and Project are in the library once something is on them, with their counts', () => {
    expect(library({}).map((item) => item.id)).toEqual(['installed', 'sources'])
    const items = library({ yours: 2, project: 1 })
    expect(items.map((item) => item.id)).toEqual(['installed', 'yours', 'project', 'sources'])
    expect(items.find((item) => item.id === 'yours')?.count).toBe(2)
    expect(sectionLabel('yours')).toBe('Yours')
    expect(sectionLabel('project')).toBe('Project')
  })
})
