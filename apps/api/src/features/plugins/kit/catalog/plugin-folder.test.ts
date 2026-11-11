import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { isPluginFolder, PLUGIN_MANIFEST } from './plugin-folder'

const root = tempDirPerTest('plugin-folder-')

describe('isPluginFolder', () => {
  test('a manifest or a top-level component marks a plugin', async () => {
    writeTree(root(), {
      'm/.claude-plugin/plugin.json': '{}',
      's/skills/x/SKILL.md': '# x',
      'o/output-styles/a.md': 'A',
      'e/README.md': 'not a plugin',
    })
    expect(await isPluginFolder(join(root(), 'm'))).toBe(true)
    expect(await isPluginFolder(join(root(), 's'))).toBe(true)
    expect(await isPluginFolder(join(root(), 'o'))).toBe(true)
    expect(await isPluginFolder(join(root(), 'e'))).toBe(false)
  })

  test('a marketplace folder and an empty .mcp.json mark nothing', async () => {
    writeTree(root(), {
      'mk/.claude-plugin/marketplace.json': '{}',
      'mcp/.mcp.json': '',
    })
    expect(await isPluginFolder(join(root(), 'mk'))).toBe(false)
    expect(await isPluginFolder(join(root(), 'mcp'))).toBe(false)
  })
})

test('PLUGIN_MANIFEST is the standard manifest location', () => {
  expect(PLUGIN_MANIFEST).toBe('.claude-plugin/plugin.json')
})
