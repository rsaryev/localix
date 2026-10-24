import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from './manifest-load'

/**
 * A plugin name may hold a `.` (manifest-reference.md, `name`: no spaces, `@`, `:`, path
 * separators, control or bidi characters), so `acme.tools` loads and installs under that name.
 */

const dir = tempDirPerTest('plugin-name-dot-')

describe('a plugin named with a dot', () => {
  it('loads under its name', async () => {
    writeTree(join(dir(), 'p'), {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'acme.tools' }),
      'skills/run/SKILL.md': '---\ndescription: Run\n---\n\nRun it.\n',
    })
    const plugin = await loadManifest(join(dir(), 'p'), 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest.name).toBe('acme.tools')
  })
})
