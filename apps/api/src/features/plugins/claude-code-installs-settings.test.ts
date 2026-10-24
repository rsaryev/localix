import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { discoverClaudeCodePlugins, readClaudeCodeInstalls } from './claude-code-installs'

/**
 * Which Claude Code installs load follows every settings file Claude Code reads: the
 * configuration directory a person moved with `CLAUDE_CONFIG_DIR`, and the managed settings an
 * organization deploys (settings-reference.md, `enabledPlugins`: "A plugin set to `false` here is
 * blocked from installation at every scope"; "Plugins force-enabled by managed settings can't be
 * disabled").
 */
const root = tempDirPerTest('cc-installs-settings-')
const managedDir = () => join(root(), 'managed')

function installTree(configDir: string, names: string[]): Record<string, string> {
  const plugins: Record<string, unknown> = {}
  const tree: Record<string, string> = {}
  for (const name of names) {
    const dir = join(root(), configDir, 'plugins/cache/mkt', name, '1.0.0')
    plugins[`${name}@mkt`] = [{ scope: 'user', installPath: dir }]
    tree[join(configDir, 'plugins/cache/mkt', name, '1.0.0/.claude-plugin/plugin.json')] =
      JSON.stringify({ name })
  }
  tree[join(configDir, 'plugins/installed_plugins.json')] = JSON.stringify({ version: 2, plugins })
  return tree
}

const ids = async (opts: Partial<Parameters<typeof readClaudeCodeInstalls>[0]>) =>
  (
    await readClaudeCodeInstalls({
      homeDir: join(root(), 'home'),
      cwd: join(root(), 'project'),
      env: {},
      managed: { dir: managedDir() },
      ...opts,
    })
  ).map((install) => install.id)

describe('Claude Code installs and the settings around them', () => {
  test('come from CLAUDE_CONFIG_DIR when the person moved their configuration', async () => {
    writeTree(root(), {
      ...installTree('work-config', ['work']),
      'work-config/settings.json': JSON.stringify({ enabledPlugins: { 'work@mkt': true } }),
      ...installTree('home/.claude', ['personal']),
    })
    expect(await ids({ env: { CLAUDE_CONFIG_DIR: join(root(), 'work-config') } })).toEqual([
      'work@mkt',
    ])
    expect(await ids({})).toEqual(['personal@mkt'])
  })

  test('a plugin managed settings turn off stays off, whatever the project says', async () => {
    writeTree(root(), {
      ...installTree('home/.claude', ['blocked', 'kept']),
      'project/.claude/settings.json': JSON.stringify({
        enabledPlugins: { 'blocked@mkt': true, 'kept@mkt': true },
      }),
      'managed/managed-settings.d/20-plugins.json': JSON.stringify({
        enabledPlugins: { 'blocked@mkt': false },
      }),
    })
    expect(await ids({})).toEqual(['kept@mkt'])
  })

  test('a plugin managed settings turn on cannot be turned off locally', async () => {
    writeTree(root(), {
      ...installTree('home/.claude', ['required']),
      'project/.claude/settings.local.json': JSON.stringify({
        enabledPlugins: { 'required@mkt': false },
      }),
      'managed/managed-settings.json': JSON.stringify({ enabledPlugins: { 'required@mkt': true } }),
    })
    const installs = await readClaudeCodeInstalls({
      homeDir: join(root(), 'home'),
      cwd: join(root(), 'project'),
      env: {},
      managed: { dir: managedDir() },
    })
    expect(installs.map(({ id, enabledBy }) => ({ id, enabledBy }))).toEqual([
      { id: 'required@mkt', enabledBy: 'policy' },
    ])
  })

  test('the local file at the repository root applies in a subfolder session', async () => {
    writeTree(root(), {
      ...installTree('home/.claude', ['noisy']),
      'repo/.git/HEAD': 'ref: refs/heads/main\n',
      'repo/.claude/settings.local.json': JSON.stringify({
        enabledPlugins: { 'noisy@mkt': false },
      }),
      'repo/packages/app/.keep': '',
    })
    expect(await ids({ cwd: join(root(), 'repo/packages/app') })).toEqual([])
  })

  test("a plugin's options keep the values the person gave them in Claude Code", async () => {
    const dir = join(root(), 'home/.claude/plugins/cache/mkt/deployer/1.0.0')
    writeTree(root(), {
      'home/.claude/plugins/installed_plugins.json': JSON.stringify({
        version: 2,
        plugins: { 'deployer@mkt': [{ scope: 'user', installPath: dir }] },
      }),
      'home/.claude/plugins/cache/mkt/deployer/1.0.0/.claude-plugin/plugin.json': JSON.stringify({
        name: 'deployer',
        userConfig: {
          api_endpoint: { type: 'string', title: 'API', description: 'Where to deploy' },
          retries: { type: 'number', title: 'Retries', description: 'How often', default: 1 },
        },
      }),
      'home/.claude/settings.json': JSON.stringify({
        pluginConfigs: { 'deployer@mkt': { options: { api_endpoint: 'https://api.example.com' } } },
      }),
      'project/.claude/settings.json': JSON.stringify({
        pluginConfigs: { 'deployer@mkt': { options: { api_endpoint: 'https://evil.example' } } },
      }),
    })
    const [plugin] = await discoverClaudeCodePlugins({
      homeDir: join(root(), 'home'),
      cwd: join(root(), 'project'),
      projectId: 'p1',
      env: {},
      managed: { dir: managedDir() },
    })
    expect(plugin?.manifest.config?.api_endpoint?.default).toBe('https://api.example.com')
    expect(plugin?.manifest.config?.retries?.default).toBe(1)
  })
})
