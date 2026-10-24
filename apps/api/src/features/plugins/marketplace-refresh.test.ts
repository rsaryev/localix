import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { addMarketplace, type MarketplaceRegistryDeps } from './marketplace-registry'
import {
  refreshMarketplaceBeforeUpdate,
  resolveFreshMarketplaceInstall,
} from './marketplace-refresh'

/**
 * `plugin install name@marketplace` reads the named marketplace again before the lookup, and
 * `plugin update` does before re-installing (loading.md, "When Claude Code refreshes a
 * marketplace before an install"). A failed refresh installs from the cached catalog and says so.
 */

const dir = tempDirPerTest('mkt-refresh-')

function upstream(plugins: string[]) {
  writeTree(join(dir(), 'upstream'), {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'acme',
      owner: { name: 'Acme' },
      plugins: plugins.map((name) => ({ name, source: `./${name}` })),
    }),
    ...Object.fromEntries(
      plugins.map((name) => [`${name}/.claude-plugin/plugin.json`, JSON.stringify({ name })]),
    ),
  })
}

function setup() {
  let failing = false
  let clock = 0
  const deps: MarketplaceRegistryDeps & {
    fail: (on: boolean) => void
    tick: (ms: number) => void
  } = {
    root: join(dir(), 'marketplaces'),
    cloneRepo: async (_url, dest) => {
      if (failing) throw new Error('network down')
      await fs.cp(join(dir(), 'upstream'), dest, { recursive: true })
    },
    fail: (on) => {
      failing = on
    },
    tick: (ms) => {
      clock += ms
    },
  }
  return { deps, now: () => clock }
}

describe('installing name@marketplace', () => {
  it('finds a plugin the marketplace added after it was added here', async () => {
    upstream(['first'])
    const { deps, now } = setup()
    await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)
    upstream(['first', 'second'])
    deps.tick(60_000)

    const notes: string[] = []
    const resolved = await resolveFreshMarketplaceInstall(
      { plugin: 'second', marketplace: 'acme' },
      deps,
      { notes, now, env: {} },
    )
    expect(resolved.entry.name).toBe('second')
    expect(notes).toEqual([])
  })

  it('installs from the cached catalog when the refresh fails, and says so', async () => {
    upstream(['first'])
    const { deps, now } = setup()
    await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)
    deps.fail(true)
    deps.tick(60_000)

    const notes: string[] = []
    const resolved = await resolveFreshMarketplaceInstall(
      { plugin: 'first', marketplace: 'acme' },
      deps,
      { notes, now, env: {} },
    )
    expect(resolved.entry.name).toBe('first')
    expect(notes.join('\n')).toContain('marketplace not refreshed')
  })
})

describe('updating a plugin', () => {
  it('reads a git marketplace again first', async () => {
    upstream(['first'])
    const { deps, now } = setup()
    await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)
    upstream(['first', 'second'])
    deps.tick(60_000)

    await refreshMarketplaceBeforeUpdate('first@acme', deps, { now, env: {} })
    const resolved = await resolveFreshMarketplaceInstall(
      { plugin: 'second', marketplace: 'acme' },
      {
        ...deps,
        cloneRepo: async () => {
          throw new Error('not again')
        },
      },
      { notes: [], now, env: {} },
    )
    expect(resolved.entry.name).toBe('second')
  })
})
