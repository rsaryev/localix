import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir, writeTree } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'

/**
 * A Claude Code marketplace end to end through the plugin service: `/plugin marketplace add` of a
 * local directory holding only `.claude-plugin/marketplace.json`, `/plugin install name@market` of
 * a `*-lsp` entry whose plugin folder has no manifest (`strict: false`, the entry declares the
 * language server), then `/plugin marketplace remove`, which uninstalls what came from it.
 */

const previousEnv = {
  LOCALIX_BUNDLED_PLUGINS_DIR: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}
let root: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

beforeAll(async () => {
  root = makeTempDir('cc-marketplace-service', {
    'marketplace/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'acme-tools',
      owner: { name: 'Acme' },
      plugins: [
        {
          name: 'typescript-lsp',
          description: 'TypeScript language server',
          version: '1.0.0',
          source: './plugins/typescript-lsp',
          category: 'development',
          strict: false,
          lspServers: {
            typescript: {
              command: 'typescript-language-server',
              args: ['--stdio'],
              extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
            },
          },
        },
      ],
    }),
    'marketplace/plugins/typescript-lsp/LICENSE': 'MIT',
    'marketplace/plugins/typescript-lsp/README.md': '# typescript-lsp',
  })
  writeTree(root, { 'home/.keep': '', 'bundled/.keep': '', 'claude/.keep': '' })
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = join(root, 'bundled')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({ db, capabilityStores, homeDir: join(root, 'home') })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('a Claude Code marketplace through the plugin service', () => {
  test('adds, installs a strict:false *-lsp entry with its lspServers, and removes', async () => {
    const added = await service.addMarketplace('u1', { source: join(root, 'marketplace') })
    expect(added).toEqual({ name: 'acme-tools', count: 1 })
    const listing = (await service.listMarketplaces('u1')).find((m) => m.name === 'acme-tools')
    expect(listing?.plugins.map((p) => p.name)).toEqual(['typescript-lsp'])

    const rec = await service.install('u1', { source: 'typescript-lsp@acme-tools', enable: true })
    expect(rec.name).toBe('typescript-lsp')
    expect(rec.version).toBe('1.0.0')
    expect(rec.provides.lspServers).toEqual(['typescript'])
    // The registered marketplace copy is untouched; the installed copy carries the manifest.
    expect(
      await fs
        .stat(join(root, 'marketplace/plugins/typescript-lsp/.claude-plugin'))
        .catch(() => null),
    ).toBeNull()

    const removed = await service.removeMarketplace('u1', { name: 'acme-tools' })
    expect(removed).toEqual({ uninstalled: ['typescript-lsp'] })
    const { plugins } = await service.listPlugins('u1')
    expect(plugins.some((p) => p.name === 'typescript-lsp')).toBe(false)
  })
})
