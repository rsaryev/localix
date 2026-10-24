import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { CapabilitySourceRecord } from '../capabilities/source-repository'
import { resolveEntryName } from './marketplace'
import { addMarketplace } from './marketplace-registry'
import { createMarketplaceMethods } from './service-marketplaces'

/**
 * What a marketplace update does to the plugins installed from it (host-marketplace.md, "Migrate
 * users with a renames map" and "Uninstall removed plugins from users' machines"; loading.md,
 * "Versions and updates"): a renamed plugin follows the chain to its current name, a removed one
 * is uninstalled when the catalog says `forceRemoveDeletedPlugins`, and a plugin whose version did
 * not change is left as it is.
 */

const dir = tempDirPerTest('mkt-update-entries-')

describe('renames', () => {
  it('follows the chain from the oldest name', () => {
    const market = { name: 'm', renames: { a: 'b', b: 'c' } }
    expect(resolveEntryName(market, 'a')).toEqual({ name: 'c', renamedFrom: 'a' })
  })

  it('refuses a chain that cycles', () => {
    expect(() => resolveEntryName({ name: 'm', renames: { a: 'b', b: 'a' } }, 'a')).toThrow(
      /chain does not resolve/,
    )
  })
})

function row(name: string): CapabilitySourceRecord {
  const at = '2026-10-01T00:00:00.000Z'
  return {
    id: name,
    userId: 'u',
    projectId: '',
    name,
    config: {},
    source: `${name}@acme`,
    createdAt: at,
    updatedAt: at,
  }
}

async function marketplace(catalog: Record<string, unknown>) {
  const root = join(dir(), 'marketplaces')
  const folder = join(dir(), 'acme')
  writeTree(folder, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'acme',
      owner: { name: 'A' },
      ...catalog,
    }),
    'current/.claude-plugin/plugin.json': JSON.stringify({ name: 'current', version: '2.0.0' }),
    'kept/.claude-plugin/plugin.json': JSON.stringify({ name: 'kept', version: '1.0.0' }),
  })
  const deps = {
    root,
    cloneRepo: async (_url: string, dest: string) => {
      await fs.cp(folder, dest, { recursive: true })
    },
  }
  await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)
  return deps
}

describe('updating a marketplace', () => {
  it('migrates a renamed plugin and uninstalls a removed one when the catalog asks', async () => {
    const registryDeps = await marketplace({
      plugins: [
        { name: 'current', source: './current' },
        { name: 'kept', source: './kept' },
      ],
      renames: { old: 'current', gone: null },
      forceRemoveDeletedPlugins: true,
    })
    const calls: string[] = []
    const methods = createMarketplaceMethods({
      registryDeps,
      repo: {
        listForScope: async () => [row('old'), row('gone'), row('vanished'), row('kept')],
      } as never,
      update: async (_user, name) => calls.push(`update ${name}`),
      remove: async (_user, name) => calls.push(`remove ${name}`),
      migrate: async (_user, from, to) => calls.push(`migrate ${from} → ${to}`),
      recheck: async () => undefined,
      env: {},
    })
    const result = await methods.updateMarketplace('u', { name: 'acme' })
    expect(calls.sort()).toEqual([
      'migrate old → current',
      'remove gone',
      'remove vanished',
      'update kept',
    ])
    expect(result.warnings).toEqual([])
  })

  it('leaves a removed plugin installed, with a warning, without forceRemoveDeletedPlugins', async () => {
    const registryDeps = await marketplace({ plugins: [{ name: 'kept', source: './kept' }] })
    const calls: string[] = []
    const methods = createMarketplaceMethods({
      registryDeps,
      repo: { listForScope: async () => [row('vanished')] } as never,
      update: async (_user, name) => calls.push(`update ${name}`),
      remove: async (_user, name) => calls.push(`remove ${name}`),
      recheck: async () => undefined,
      env: {},
    })
    const result = await methods.updateMarketplace('u', { name: 'acme' })
    expect(calls).toEqual([])
    expect(result.warnings).toEqual(['vanished: Plugin "vanished" not found in marketplace "acme"'])
  })
})
