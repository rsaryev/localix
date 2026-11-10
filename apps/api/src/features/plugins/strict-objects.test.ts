/**
 * The manifest's strict objects (plugins/manifest-reference, "Unrecognized fields"): an unknown key
 * inside a `userConfig` option or a `channels` entry is an error, and the plugin doesn't load; in a
 * `monitors` entry it is an issue, and only that monitor is dropped.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './manifest-load'

const dir = tempDirPerTest('strict-objects-')

async function load(manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  const all = { '.claude-plugin/plugin.json': JSON.stringify({ name: 'p', ...manifest }), ...files }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir(), path)), { recursive: true })
    writeFileSync(join(dir(), path), text)
  }
  return loadManifest(dir(), 'global', '')
}

describe('an unknown key in a strict manifest object', () => {
  test('in a channels entry keeps the plugin from loading', async () => {
    const plugin = await load({
      mcpServers: { tg: { command: 'node', args: ['s.js'] } },
      channels: [{ server: 'tg', displayname: 'Telegram' }],
    })
    expect(plugin.error).toContain('channels')
  })

  // Behaviour change (kit wins): a bad monitors entry is an issue on a plugin that still loads,
  // without that monitor; Localix used to refuse the whole plugin.
  test('in a monitors entry is an issue, and that monitor is not run', async () => {
    const plugin = await load(
      {},
      {
        'monitors/monitors.json': JSON.stringify([
          { name: 'log', command: 'tail -F x', description: 'Log', when: 'always', every: 5 },
        ]),
      },
    )
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifestIssues?.some((issue) => issue.message.includes('every'))).toBe(true)
    expect(plugin.entrypoints.monitors).toEqual([])
  })

  test('a valid monitor still loads', async () => {
    const plugin = await load(
      {},
      {
        'monitors/monitors.json': JSON.stringify([
          { name: 'log', command: 'tail -F x', description: 'Log' },
        ]),
      },
    )
    expect(plugin.error).toBeUndefined()
    expect(plugin.entrypoints.monitors.map((monitor) => monitor.name)).toEqual(['log'])
  })
})
