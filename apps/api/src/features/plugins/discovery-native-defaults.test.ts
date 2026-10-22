import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { MANIFEST_FILE } from '@localixai/claude-plugin'
import { MINI_APP_MANIFEST_FILE } from '@localixai/plugin-sdk/app-manifest'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from './discovery'

/**
 * A Claude Code plugin must never run Localix native code: a `tools.js` or `tools/index.*` it
 * ships is just a file to Claude Code, yet Localix used to import it in-process as native tools.
 * Only a mini app finds one by convention; a root `plugin.json` is the plugin's own claim.
 */
const dir = tempDirPerTest('native-defaults-')
const TOOLS = 'export const tools = []\n'

const load = async (tree: Record<string, string>) => {
  writeTree(dir(), tree)
  return loadManifest(dir(), 'global', '')
}

describe('native entrypoint defaults', () => {
  test('a Claude Code plugin with tools.js and tools/index.ts gets no native entrypoint', async () => {
    const plugin = await load({
      [MANIFEST_FILE]: JSON.stringify({ name: 'cc' }),
      'tools.js': TOOLS,
      'tools/index.ts': TOOLS,
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.entrypoints.toolEntries).toEqual([])
    expect(plugin.provides.hasNativeTools).toBe(false)
  })

  test('a folder with no manifest gets no native entrypoint', async () => {
    const plugin = await load({ 'tools/index.mjs': TOOLS, 'skills/a/SKILL.md': '# a\n' })
    expect(plugin.entrypoints.toolEntries).toEqual([])
  })

  test('a legacy plugin.json an earlier version wrote for a Claude Code import gets none', async () => {
    const plugin = await load({
      'plugin.json': JSON.stringify({ name: 'imported', origin: { format: 'claude-code' } }),
      'tools.js': TOOLS,
    })
    expect(plugin.entrypoints.toolEntries).toEqual([])
  })

  test('a mini app keeps the tools/ convention and its declared backend', async () => {
    const byConvention = await load({
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'app' }),
      'tools/index.ts': TOOLS,
    })
    expect(byConvention.entrypoints.toolEntries).toEqual([join(dir(), 'tools/index.ts')])
  })

  test('a mini app beside a Claude Code plugin runs its declared backend', async () => {
    const plugin = await load({
      [MANIFEST_FILE]: JSON.stringify({ name: 'both' }),
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'both', backend: './backend/index.ts' }),
      'backend/index.ts': TOOLS,
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.entrypoints.toolEntries).toEqual([join(dir(), 'backend/index.ts')])
    expect(plugin.provides.hasNativeTools).toBe(true)
  })

  test('a root plugin.json without origin gets no native entrypoint by convention', async () => {
    // Claude Code ignores a root plugin.json: a folder it installed may still carry one.
    const plugin = await load({
      'plugin.json': JSON.stringify({ name: 'old', version: '1' }),
      'tools.mjs': TOOLS,
      'tools/index.ts': TOOLS,
    })
    expect(plugin.layout).toBe('legacy')
    expect(plugin.entrypoints.toolEntries).toEqual([])
    expect(plugin.provides.hasNativeTools).toBe(false)
  })

  test('a legacy Localix plugin.json runs the entrypoint its tools field names', async () => {
    const plugin = await load({
      'plugin.json': JSON.stringify({ name: 'old', version: '1', tools: './tools.mjs' }),
      'tools.mjs': TOOLS,
    })
    expect(plugin.entrypoints.toolEntries).toEqual([join(dir(), 'tools.mjs')])
  })
})
