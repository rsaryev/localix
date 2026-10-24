/**
 * A packaged MCP server (`.mcpb`, or the older `.dxt`) in a plugin's `mcpServers` (plugins/components,
 * "Include a packaged MCPB server"): it is extracted into `.mcpb-cache/` under the plugin root, the
 * server takes its name and config from the bundle's manifest, and a bundle setting that is
 * required and has no saved value keeps the server from starting.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runSync, tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './manifest-load'
import { buildMcpRecords } from './mcp'

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

/** A `.mcpb` zip holding the bundle manifest and its server, at `out`. */
function makeBundle(out: string) {
  const src = join(dir(), 'bundle-src')
  mkdirSync(join(src, 'server'), { recursive: true })
  writeFileSync(join(src, 'manifest.json'), JSON.stringify(BUNDLE_MANIFEST))
  writeFileSync(join(src, 'server', 'index.js'), 'console.log("hi")')
  mkdirSync(dirname(out), { recursive: true })
  const zipped = runSync('zip', ['-qr', out, '.'], { cwd: src })
  expect(zipped.code).toBe(0)
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

    expect(buildMcpRecords(discovered, {}, 'u', 'ts', dir(), logger)).toEqual([])
    expect(warnings.at(-1)).toContain(
      'Bundled MCP server "db-server" was not started: it needs configuration',
    )

    const [record] = buildMcpRecords(discovered, { 'db-server.token': 'abc' }, 'u', 'ts', dir())
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
})
