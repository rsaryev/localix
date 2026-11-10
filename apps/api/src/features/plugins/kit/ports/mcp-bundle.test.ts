import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { makeZip } from '../../../../testing/zip-fixture'
import { mcpBundleReader } from './mcp-bundle'

const dir = tempDirPerTest('kit-mcp-bundle')

const MANIFEST = {
  name: 'db-server',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: { DB_TOKEN: '${user_config.token}', OTHER: '${UNKNOWN}' },
    },
  },
  user_config: {
    token: { type: 'string', required: true },
    region: { type: 'string', required: true, default: 'eu' },
    verbose: { type: 'boolean' },
  },
}

function plugin(): string {
  const root = join(dir(), 'plugin')
  mkdirSync(join(root, 'bundles'), { recursive: true })
  writeFileSync(
    join(root, 'bundles/db.mcpb'),
    makeZip([
      { name: 'manifest.json', data: JSON.stringify(MANIFEST) },
      { name: 'server/index.js', data: '' },
    ]),
  )
  writeFileSync(join(root, 'bundles/broken.mcpb'), 'not a zip')
  writeFileSync(
    join(root, 'bundles/nameless.mcpb'),
    makeZip([{ name: 'manifest.json', data: JSON.stringify({ server: MANIFEST.server }) }]),
  )
  return root
}

describe('the MCP bundle reader of one plugin', () => {
  test('extracts a bundle and gives its server, as the bundle manifest declares it', async () => {
    const root = plugin()
    const opened = await mcpBundleReader(root).open(
      { kind: 'path', path: 'bundles/db.mcpb' },
      '.mcpb-cache',
    )
    expect(opened).toMatchObject({
      name: 'db-server',
      server: { command: 'node', env: { DB_TOKEN: '${user_config.token}', OTHER: '${UNKNOWN}' } },
      // The bundle's own `user_config` block, as written: the kit reads it into options.
      userConfig: MANIFEST.user_config,
    })
    expect(JSON.stringify(opened)).toContain(join(root, '.mcpb-cache'))
  })

  test('has no bundle for a missing path, and a failure for one that cannot be read', async () => {
    const reader = mcpBundleReader(plugin())
    expect(
      await reader.open({ kind: 'path', path: 'bundles/none.mcpb' }, '.mcpb-cache'),
    ).toBeUndefined()
    expect(
      await reader.open({ kind: 'path', path: 'bundles/broken.mcpb' }, '.mcpb-cache'),
    ).toMatchObject({
      failure: 'bundle',
    })
    expect(
      await reader.open({ kind: 'path', path: 'bundles/nameless.mcpb' }, '.mcpb-cache'),
    ).toEqual({
      failure: 'bundle',
      message: 'the bundle manifest has no name',
    })
  })
})
