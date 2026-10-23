import { describe, expect, test } from 'bun:test'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from './discovery'
import { MINI_APP_FILE } from './layout/read'

/**
 * A mini app is never a plugin (rule X2): a folder holding a `mini-app.json` does not load as one,
 * whatever Claude Code component folders sit beside it. It is added from Settings → Mini apps.
 */
const dir = tempDirPerTest('mini-app-discovery-')

describe('a mini-app.json folder among plugins', () => {
  test('surfaces as an error that points at mini apps, not as a plugin', async () => {
    writeTree(dir(), {
      [MINI_APP_FILE]: JSON.stringify({ name: 'calories', version: '0.1.0' }),
      'skills/log/SKILL.md': '---\nname: log\ndescription: Log meals\n---\nBody\n',
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'calories' }),
    })
    const found = await loadManifest(dir(), 'global', '')
    expect(found.error).toContain('is a mini app')
    expect(found.error).toContain('Settings → Mini apps')
  })
})
