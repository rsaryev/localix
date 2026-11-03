import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import {
  DEFAULT_MARKETPLACES,
  ensureDefaultMarketplaces,
  forgetDefaultMarketplaceRemoval,
  rememberDefaultMarketplaceRemoval,
} from './default-marketplaces'
import {
  type KnownMarketplace,
  readKnownMarketplaces,
  writeKnownMarketplaces,
} from './marketplace-catalog'
import type { MarketplaceSource } from './marketplace-source'

const dir = tempDirPerTest('default-marketplaces-')
const root = () => join(dir(), 'marketplaces')

/** An add that registers under the default's own name, the way the catalog would name it. */
function adder(fail?: Error) {
  const calls: MarketplaceSource[] = []
  const add = async (source: MarketplaceSource) => {
    calls.push(source)
    if (fail) throw fail
    const name = DEFAULT_MARKETPLACES.find((found) => found.source === source)!.id
    const known = await readKnownMarketplaces(root())
    known[name] = { source, installLocation: join(root(), name) }
    await writeKnownMarketplaces(root(), known)
    return { name, count: 1 }
  }
  return { add, calls }
}
const ensure = (add: ReturnType<typeof adder>['add'], env = {}) =>
  ensureDefaultMarketplaces({ root: root(), add, env })

describe('the default marketplaces on start', () => {
  test('are Localix’s, Localix Community, the official and the community ones, for browsing', () => {
    expect(DEFAULT_MARKETPLACES.map((found) => [found.id, found.source])).toEqual([
      [
        'localix',
        {
          source: 'github',
          repo: 'rsaryev/localix-marketplace',
          sparsePaths: ['.claude-plugin', 'plugins'],
        },
      ],
      [
        'localix-community',
        { source: 'github', repo: 'rsaryev/localix-community', sparsePaths: ['.claude-plugin'] },
      ],
      ['claude-plugins-official', { source: 'github', repo: 'anthropics/claude-plugins-official' }],
      ['claude-community', { source: 'github', repo: 'anthropics/claude-plugins-community' }],
    ])
  })

  test('each is registered when it is not there yet; nothing is installed', async () => {
    const { add, calls } = adder()
    expect(await ensure(add)).toEqual({
      localix: { status: 'registered' },
      'localix-community': { status: 'registered' },
      'claude-plugins-official': { status: 'registered' },
      'claude-community': { status: 'registered' },
    })
    expect(calls).toHaveLength(4)
    expect((await ensure(add))['claude-community']).toEqual({ status: 'present' })
    expect(calls).toHaveLength(4)
  })

  test('one registered already from the same repository, under any name, is reused', async () => {
    await writeKnownMarketplaces(root(), {
      'my-official': {
        source: { source: 'github', repo: 'Anthropics/claude-plugins-official.git' },
        installLocation: join(root(), 'my-official'),
      },
    })
    const { add, calls } = adder()
    expect((await ensure(add))['claude-plugins-official']).toEqual({ status: 'present' })
    expect(calls.map((source) => source.source === 'github' && source.repo)).not.toContain(
      'anthropics/claude-plugins-official',
    )
  })

  test('Localix’s, still registered from the core repository it moved out of, follows the move', async () => {
    // A profile from v0.1.0-beta.17 or older: `localix` was the core repository's own catalog.
    const before = {
      source: {
        source: 'github',
        repo: 'rsaryev/localix',
        sparsePaths: ['.claude-plugin', 'plugins'],
      },
      installLocation: join(root(), 'localix'),
      autoUpdate: true,
    } satisfies KnownMarketplace
    await writeKnownMarketplaces(root(), { localix: before })
    const offline = adder(new Error('getaddrinfo ENOTFOUND github.com'))
    expect((await ensure(offline.add)).localix).toEqual({
      status: 'moved',
      from: 'github:rsaryev/localix',
    })
    // Even when the new home cannot be fetched now, the record points there: the next refresh or
    // install reads the new catalog, never the one the core repository no longer carries.
    const official = DEFAULT_MARKETPLACES.find((found) => found.id === 'localix')!.source
    expect((await readKnownMarketplaces(root())).localix).toEqual({ ...before, source: official })
    expect(offline.calls[0]).toEqual(official)

    const { add, calls } = adder()
    expect((await ensure(add)).localix).toEqual({ status: 'present' })
    expect(calls).not.toContainEqual(official)
  })

  test('a `localix` the person registered from another repository keeps its source', async () => {
    const theirs = {
      source: { source: 'github', repo: 'someone/localix-fork' },
      installLocation: join(root(), 'localix'),
    } satisfies KnownMarketplace
    await writeKnownMarketplaces(root(), { localix: theirs })
    expect((await ensure(adder().add)).localix).toEqual({ status: 'present' })
    expect((await readKnownMarketplaces(root())).localix).toEqual(theirs)
  })

  test('one the person removed is not added back, until they add it themselves', async () => {
    const { add, calls } = adder()
    await rememberDefaultMarketplaceRemoval(root(), 'claude-community')
    expect((await ensure(add))['claude-community']).toEqual({ status: 'declined' })
    expect(calls).toHaveLength(3)
    await forgetDefaultMarketplaceRemoval(root(), 'claude-community')
    expect((await ensure(add))['claude-community']).toEqual({ status: 'registered' })
  })

  test('none is fetched offline, and a failed fetch is tried again at the next start', async () => {
    const offline = adder()
    const skipped = await ensure(offline.add, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
    expect(Object.values(skipped).map((outcome) => outcome.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ])
    expect(offline.calls).toHaveLength(0)

    const failing = adder(new Error('getaddrinfo ENOTFOUND github.com'))
    expect((await ensure(failing.add)).localix).toEqual({
      status: 'skipped',
      reason: 'getaddrinfo ENOTFOUND github.com',
    })
    expect((await ensure(adder().add)).localix).toEqual({ status: 'registered' })
  })
})
