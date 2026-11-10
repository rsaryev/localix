import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadPlugin } from '@rsaryev/llx-plugin'
import { memoryFiles } from '@rsaryev/llx-plugin/testing'
import { tempDirPerTest } from '@localixai/testing'
import { createLocalixPluginHost, type PluginHostDeps } from './host'
import type { McpCallByName } from './ports/session-ports'

const dir = tempDirPerTest('kit-host')
const signal = new AbortController().signal

function deps(bound: { mcp?: McpCallByName } = {}): PluginHostDeps {
  return {
    homeDir: dir(),
    environment: () => ({ PATH: process.env.PATH }),
    pluginsRoot: () => join(dir(), '.localix/plugins'),
    scratchDir: () => join(dir(), 'scratch'),
    envFilesDir: (sessionId) => join(dir(), 'sessions', sessionId),
    managedDirectory: undefined,
    mcp: () => bound.mcp,
    models: () => undefined,
  }
}

async function plugin(name: string) {
  const files = memoryFiles({
    '.claude-plugin/plugin.json': JSON.stringify({ name }),
    'skills/review/SKILL.md': '---\ndescription: Review\n---\nReview it.',
  })
  const loaded = await loadPlugin({ files })
  if (!loaded.plugin) throw new Error('fixture does not load')
  return loaded.plugin
}

describe('the plugin host of the app process', () => {
  test('starts with no plugin and takes the loaded ones with their roots', async () => {
    const host = createLocalixPluginHost(deps())
    expect(host.plugins()).toEqual([])
    host.setPlugins([
      { id: 'fmt@acme', root: '/plugins/fmt', plugin: await plugin('fmt') },
      { id: 'off@acme', root: '/plugins/off', plugin: await plugin('off') },
    ])
    // Whether one runs is each session's settings' to say; the host's own say every one does.
    expect(host.plugins()).toEqual([
      { id: 'fmt@acme', name: 'fmt', enabled: true },
      { id: 'off@acme', name: 'off', enabled: true },
    ])
    expect(host.generation).toBe(1)
    // `${CLAUDE_PLUGIN_ROOT}` of a plugin is the folder it was loaded from.
    expect(host.ports.host.locations.pluginRoot('fmt@acme')).toBe('/plugins/fmt')
  })

  test('holds the plugins of every scope fed, and changes only when a scope does', async () => {
    const host = createLocalixPluginHost(deps())
    const fmt = { id: 'fmt@acme', root: '/plugins/fmt', plugin: await plugin('fmt') }
    const lint = { id: 'lint@acme', root: '/plugins/lint', plugin: await plugin('lint') }
    host.feedScope('/work/a', [fmt])
    host.feedScope('/work/b', [{ ...fmt }, lint])
    expect([host.plugins().map(({ id }) => id), host.generation]).toEqual([
      ['fmt@acme', 'lint@acme'],
      2,
    ])
    host.feedScope('/work/a', [{ ...fmt }])
    expect(host.generation).toBe(2)
    // Uninstalled where both scopes saw it: gone once each has read its catalog again.
    host.feedScope('/work/a', [])
    host.feedScope('/work/b', [lint])
    expect(host.plugins().map(({ id }) => id)).toEqual(['lint@acme'])
  })

  test('reads the MCP engine bootstrap brings up after the host was made', async () => {
    const bound: { mcp?: McpCallByName } = {}
    const host = createLocalixPluginHost(deps(bound))
    expect(await host.ports.host.mcp.ensureConnected('db', 0, signal)).toBe('unavailable')
    bound.mcp = async () => ({ text: 'ok' })
    expect(await host.ports.host.mcp.ensureConnected('db', 0, signal)).toBe('connected')
  })
})
