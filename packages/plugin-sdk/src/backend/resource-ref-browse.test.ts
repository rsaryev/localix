import { describe, expect, test } from 'bun:test'

import { createResourceBrowser } from './resource-ref-browse'
import type { ResourceNode, ResourceRefProvider } from './resource-ref-contracts'
import { buildResourceUri } from './resource-uri'

const node = (segments: string[], label: string, extra: Partial<ResourceNode> = {}) => ({
  uri: buildResourceUri('db', segments),
  label,
  hasChildren: false,
  ...extra,
})

/** A `db` provider whose roots and children each carry a provider notice beside two rows. */
function browser() {
  const listings: Record<string, ResourceNode[]> = {
    root: [
      node(['main'], 'Main', { hasChildren: true }),
      node(['replica'], 'Replica', { hasChildren: true }),
      node(['root-warning'], 'Roots are partial', { notice: true }),
    ],
    [buildResourceUri('db', ['main'])]: [
      node(['main', 'users'], 'users'),
      node(['main', 'orders'], 'orders'),
      node(['main', 'child-warning'], 'Tables are partial', { notice: true }),
    ],
  }
  const provider: ResourceRefProvider = {
    provider: 'db',
    title: 'Databases',
    listChildren: async () => [],
    expand: async () => ({ ok: false }),
  }
  return createResourceBrowser({
    byProvider: new Map([['db', provider]]),
    listProviderChildren: async (_provider, _userId, parentUri) =>
      listings[parentUri ?? 'root'] ?? [],
    maxNodesPerProvider: 100,
    warnListFailure: () => [],
  })
}

const labels = (result: { groups: { resources: ResourceNode[] }[] }) =>
  result.groups.flatMap((group) => group.resources.map((resource) => resource.label))

describe('resource browse', () => {
  test('a provider root lists its rows, filtered by the segment, and moves notices aside', async () => {
    const browse = browser()
    const all = await browse('user', `${buildResourceUri('db')}/`)
    expect(labels(all)).toEqual(['Main', 'Replica'])
    expect(all.notices.map((notice) => notice.label)).toEqual(['Roots are partial'])

    const searched = await browse('user', `${buildResourceUri('db')}/rep`)
    expect(labels(searched)).toEqual(['Replica'])
    expect(searched.notices.map((notice) => notice.label)).toEqual(['Roots are partial'])
  })

  test('a child level does the same with the children of its parent', async () => {
    const browse = browser()
    const all = await browse('user', `${buildResourceUri('db', ['main'])}/`)
    expect(labels(all)).toEqual(['orders', 'users'])
    expect(all.notices.map((notice) => notice.label)).toEqual(['Tables are partial'])

    const searched = await browse('user', `${buildResourceUri('db', ['main'])}/us`)
    expect(labels(searched)).toEqual(['users'])
    expect(searched.groups.map((group) => group.label)).toEqual(['Databases'])
  })
})
