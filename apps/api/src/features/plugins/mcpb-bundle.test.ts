/**
 * A packaged MCP server (`.mcpb`, or the older `.dxt`) in a plugin's `mcpServers` (plugins/components,
 * "Include a packaged MCPB server"): it is extracted into `.mcpb-cache/` under the plugin root, the
 * server takes its name and config from the bundle's manifest, and a bundle setting that is
 * required and has no saved value keeps the server from starting.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { CASE_COLLISION_LINKS, makeZip, type ZipFixtureEntry } from '../../testing/zip-fixture'

import { loadManifest } from './manifest-load'
import { pluginMcpRecords } from './testing/test-mcp-records'

const dir = tempDirPerTest('mcpb-bundle-')
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const BUNDLE_MANIFEST = {
  manifest_version: '0.2',
  name: 'db-server',
  version: '1.0.0',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: { DB_TOKEN: '${user_config.token}' },
    },
  },
  user_config: {
    token: {
      type: 'string',
      title: 'Token',
      description: 'DB token',
      required: true,
      sensitive: true,
    },
  },
}

/** A `.mcpb` zip holding the bundle manifest, its server and any `extra` entries, at `out`. */
function makeBundle(out: string, extra: ZipFixtureEntry[] = []) {
  // Built in-process: a `zip` binary is not on every machine that runs the tests.
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(
    out,
    makeZip([
      { name: 'manifest.json', data: JSON.stringify(BUNDLE_MANIFEST) },
      { name: 'server/index.js', data: 'console.log("hi")' },
      ...extra,
    ]),
  )
}

function plugin(mcpServers: unknown) {
  const root = join(dir(), 'plugin')
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'db', mcpServers }),
  )
  return root
}

const warnings: string[] = []
const logger = { warn: (message: string) => warnings.push(message) }

describe('a packaged MCP server in a plugin', () => {
  test('runs from .mcpb-cache under its own name, once its required setting is saved', async () => {
    const root = plugin('./servers/db.mcpb')
    makeBundle(join(root, 'servers', 'db.mcpb'))
    const discovered = await loadManifest(root, 'global', '')

    const server = discovered.entrypoints.mcpServers['db-server'] as { args: string[] }
    expect(server.args[0]).toStartWith(join(root, '.mcpb-cache'))
    expect(readFileSync(server.args[0]!, 'utf8')).toContain('hi')
    expect(discovered.manifest.config?.['db-server.token']).toMatchObject({
      required: true,
      secret: true,
    })

    expect(await pluginMcpRecords(discovered, {}, dir(), logger)).toEqual([])
    expect(warnings.at(-1)).toContain('db-server')

    const [record] = await pluginMcpRecords(discovered, { 'db-server.token': 'abc' }, dir())
    expect((record!.config as { env: Record<string, string> }).env.DB_TOKEN).toBe('abc')
  })

  test('downloads a bundle named by an https URL into .mcpb-cache', async () => {
    const zip = join(dir(), 'remote.mcpb')
    makeBundle(zip)
    const bytes = readFileSync(zip)
    const asked: string[] = []
    globalThis.fetch = (async (url: string | URL) => {
      asked.push(String(url))
      return new Response(bytes, { status: 200 })
    }) as typeof fetch
    const root = plugin('https://example.com/db.mcpb')
    const discovered = await loadManifest(root, 'global', '')

    expect(asked).toEqual(['https://example.com/db.mcpb'])
    const server = discovered.entrypoints.mcpServers['db-server'] as { args: string[] }
    expect(server.args[0]).toStartWith(join(root, '.mcpb-cache'))
  })

  test('a bundle with a link out of its folder is refused and nothing of it is unpacked', async () => {
    const root = plugin('./servers/db.mcpb')
    makeBundle(join(root, 'servers', 'db.mcpb'), [
      { name: 'server/escape', data: '../../../..', unixMode: 0o120777 },
    ])
    const discovered = await loadManifest(root, 'global', '')

    expect(discovered.entrypoints.mcpServers['db-server']).toBeUndefined()
    const cache = join(root, '.mcpb-cache')
    const unpacked = existsSync(cache)
      ? readdirSync(cache).filter((name) => !name.endsWith('.mcpb'))
      : []
    expect(unpacked).toEqual([])
  })

  /** What sits in `.mcpb-cache` besides the bundle's own folder: anything else was planted. */
  function plantedBeside(root: string) {
    const cache = join(root, '.mcpb-cache')
    if (!existsSync(cache)) return []
    return readdirSync(cache).filter((name) => !name.startsWith('db-'))
  }

  test('a bundle whose links chain out of its folder by case plants nothing beside it', async () => {
    const root = plugin('./servers/db.mcpb')
    makeBundle(join(root, 'servers', 'db.mcpb'), [
      { name: 'plugin/skills/x.md', data: 'PLANTED' },
      ...CASE_COLLISION_LINKS,
    ])
    await loadManifest(root, 'global', '')

    expect(plantedBeside(root)).toEqual([])
    const besidePlugin = readdirSync(root).filter((name) => name !== '.mcpb-cache')
    expect(besidePlugin.toSorted()).toEqual(['.claude-plugin', 'servers'])
  })

  test('a bundle with a link that really resolves out of its folder is refused', async () => {
    const root = plugin('./servers/db.mcpb')
    makeBundle(join(root, 'servers', 'db.mcpb'), [
      { name: 'here', data: '.', unixMode: 0o120777 },
      { name: 'server/out', data: '../here/..', unixMode: 0o120777 },
    ])
    const discovered = await loadManifest(root, 'global', '')

    expect(discovered.entrypoints.mcpServers['db-server']).toBeUndefined()
    expect(plantedBeside(root)).toEqual([])
  })
})
