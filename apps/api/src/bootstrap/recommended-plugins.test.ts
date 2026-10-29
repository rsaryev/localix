import { describe, expect, test } from 'bun:test'
import type { Listing } from '@localixai/store'
import { makeListing } from '@localixai/store/testing'

import { recommendedPlugins } from './recommended-plugins'

const plugin = (id: string, trust: 'localix' | 'community', over: Partial<Listing> = {}) =>
  makeListing({ id, kind: 'plugin', source: { id: trust, label: trust, trust }, ...over })

const storeOf = (listings: Listing[]) => ({
  listings: async () => ({ listings }) as never,
})

describe('what Localix’s marketplace recommends, read from the Store', () => {
  test('its recommended plugins, each with whether it is installed; nobody else’s', async () => {
    const answer = await recommendedPlugins(
      storeOf([
        plugin('team@localix', 'localix', { recommended: true }),
        plugin('authoring@localix', 'localix', {
          recommended: true,
          installs: [{ scope: 'user', enabled: true }],
        }),
        plugin('other@localix', 'localix'),
        plugin('loud@someone', 'community', { recommended: true }),
      ]),
      'u1',
    )
    expect(answer).toEqual([
      { id: 'team@localix', installed: false },
      { id: 'authoring@localix', installed: true },
    ])
  })

  test('nothing to answer before its marketplace is listed', async () => {
    expect(await recommendedPlugins(storeOf([plugin('loud@someone', 'community')]), 'u1')).toBe(
      null,
    )
  })
})
