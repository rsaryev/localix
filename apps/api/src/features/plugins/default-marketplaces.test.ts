import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import {
  DEFAULT_MARKETPLACES,
  ensureDefaultMarketplaces,
  forgetDefaultMarketplaceRemoval,
  rememberDefaultMarketplaceRemoval,
} from './default-marketplaces'
import { readKnownMarketplaces, writeKnownMarketplaces } from './marketplace-catalog'
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
  test('are Localix’s, the official and the community ones, for browsing', () => {
    expect(DEFAULT_MARKETPLACES.map((found) => [found.id, found.source])).toEqual([
      [
        'localix',
        {
          source: 'github',
          repo: 'rsaryev/localix-marketplace',
          sparsePaths: ['.claude-plugin', 'plugins'],
        },
      ],
      ['claude-plugins-official', { source: 'github', repo: 'anthropics/claude-plugins-official' }],
      ['claude-community', { source: 'github', repo: 'anthropics/claude-plugins-community' }],
    ])
  })

  test('each is registered when it is not there yet; nothing is installed', async () => {
    const { add, calls } = adder()
    expect(await ensure(add)).toEqual({
      localix: { status: 'registered' },
      'claude-plugins-official': { status: 'registered' },
      'claude-community': { status: 'registered' },
    })
    expect(calls).toHaveLength(3)
    expect((await ensure(add))['claude-community']).toEqual({ status: 'present' })
    expect(calls).toHaveLength(3)
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

  test('one the person removed is not added back, until they add it themselves', async () => {
    const { add, calls } = adder()
    await rememberDefaultMarketplaceRemoval(root(), 'claude-community')
    expect((await ensure(add))['claude-community']).toEqual({ status: 'declined' })
    expect(calls).toHaveLength(2)
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
