import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { builtinPluginNames, stageBuiltinPlugins } from './stage-builtin-plugins.mjs'

const dir = tempDirPerTest('stage-builtin-plugins-')
const REPO_ROOT = join(import.meta.dir, '..')

describe('stageBuiltinPlugins', () => {
  test('copies each Claude Code plugin under plugins/ and nothing else', () => {
    writeTree(dir(), {
      'plugins/README.md': '# Plugins',
      'plugins/guide/.claude-plugin/plugin.json': JSON.stringify({ name: 'guide' }),
      'plugins/guide/commands/new.md': 'New.\n',
      'plugins/guide/commands/new.test.ts': 'test\n',
      'plugins/guide/node_modules/x/index.js': 'x\n',
      'plugins/cache-only/.turbo/log': 'x\n',
      'plugins/legacy/plugin.json': JSON.stringify({ name: 'legacy' }),
    })
    const out = join(dir(), 'resources', 'builtin-plugins')
    expect(stageBuiltinPlugins({ repoRoot: dir(), out })).toEqual(['guide'])
    expect(readdirSync(out)).toEqual(['guide'])
    expect(readFileSync(join(out, 'guide', 'commands', 'new.md'), 'utf8')).toBe('New.\n')
    expect(existsSync(join(out, 'guide', 'commands', 'new.test.ts'))).toBe(false)
    expect(existsSync(join(out, 'guide', 'node_modules'))).toBe(false)
  })

  test('replaces what an earlier stage left', () => {
    writeTree(dir(), {
      'plugins/guide/.claude-plugin/plugin.json': JSON.stringify({ name: 'guide' }),
      'resources/builtin-plugins/gone/.claude-plugin/plugin.json': '{}',
    })
    const out = join(dir(), 'resources', 'builtin-plugins')
    stageBuiltinPlugins({ repoRoot: dir(), out })
    expect(readdirSync(out)).toEqual(['guide'])
  })

  test('the repository’s marketplace lists every built-in plugin by its relative source', () => {
    const catalog = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'),
    ) as { name: string; plugins: Array<{ name: string; source: string }> }
    expect(catalog.name).toBe('localix')
    const names = builtinPluginNames(REPO_ROOT)
    expect(names).toContain('mini-app-authoring')
    const byName = (a: string[], b: string[]) => (a[0] ?? '').localeCompare(b[0] ?? '')
    expect(catalog.plugins.map((entry) => [entry.name, entry.source]).sort(byName)).toEqual(
      names.map((name) => [name, `./plugins/${name}`]).sort(byName),
    )
  })
})
