import { describe, expect, test } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { readClaudeCodeInstalls } from './claude-code-installs'
import { discoverPlugins } from './discovery'

/**
 * Plugins installed in Claude Code appear in Localix as Claude Code itself sees them, read in
 * place from `~/.claude/plugins`. Every fixture is written by hand into a temp home; the real
 * `~/.claude` is never read.
 */
const root = tempDirPerTest('cc-installs-')
const home = () => join(root(), 'home')
const project = () => join(root(), 'project')
const cache = (name: string) => join(home(), '.claude/plugins/cache/mkt', name, '1.0.0')
const market = () => join(home(), '.claude/plugins/marketplaces/mkt')

const manifest = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, description: `${name} plugin`, ...extra })
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\n\nDo ${name}.\n`

function install(scope: 'user' | 'project' | 'local', name: string, projectPath?: string) {
  return [
    {
      scope,
      ...(projectPath ? { projectPath } : {}),
      installPath: cache(name),
      version: '1.0.0',
      installedAt: '2026-10-01T00:00:00.000Z',
      lastUpdated: '2026-10-01T00:00:00.000Z',
    },
  ]
}

function fixture(): void {
  const plugins = ['alpha', 'beta', 'gamma', 'delta', 'quiet', 'plain', 'shadow']
  const tree: Record<string, string> = {
    '.claude/plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: {
        'alpha@mkt': install('user', 'alpha'),
        'beta@mkt': install('user', 'beta'),
        'gamma@mkt': install('project', 'gamma', project()),
        'delta@mkt': install('user', 'delta'),
        'quiet@mkt': install('user', 'quiet'),
        'plain@mkt': install('user', 'plain'),
        'shadow@mkt': install('user', 'shadow'),
        'lsp@mkt': install('user', 'lsp'),
        'gone@mkt': [{ scope: 'user', installPath: join(root(), 'nowhere') }],
      },
    }),
    '.claude/plugins/known_marketplaces.json': JSON.stringify({
      mkt: { source: { source: 'github', repo: 'acme/mkt' }, installLocation: market() },
    }),
    '.claude/settings.json': JSON.stringify({
      enabledPlugins: {
        'alpha@mkt': true,
        'beta@mkt': false,
        'delta@mkt': true,
        'shadow@mkt': true,
        'lsp@mkt': true,
        'rel@mkt': true,
        'gone@mkt': true,
      },
    }),
    // A Localix install of the same name wins over Claude Code's.
    '.localix/plugins/shadow/.claude-plugin/plugin.json': manifest('shadow'),
    [join('.claude/plugins/marketplaces/mkt', '.claude-plugin/marketplace.json')]: JSON.stringify({
      name: 'mkt',
      owner: { name: 'Acme' },
      plugins: [
        { name: 'rel', source: './plugins/rel' },
        {
          name: 'lsp',
          source: { source: 'github', repo: 'acme/lsp' },
          lspServers: { go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
        },
      ],
    }),
    '.claude/plugins/marketplaces/mkt/plugins/rel/.claude-plugin/plugin.json': manifest('rel'),
    '.claude/plugins/marketplaces/mkt/plugins/rel/skills/rel-skill/SKILL.md': skill('rel-skill'),
    // The cache folder of a manifest-less plugin is named after its version.
    [join('.claude/plugins/cache/mkt/lsp/1.0.0', 'README.md')]: 'Go language server.\n',
  }
  for (const name of plugins) {
    const rel = join('.claude/plugins/cache/mkt', name, '1.0.0')
    tree[join(rel, '.claude-plugin/plugin.json')] = manifest(
      name,
      name === 'quiet' ? { defaultEnabled: false } : {},
    )
    tree[join(rel, `skills/${name}-skill/SKILL.md`)] = skill(`${name}-skill`)
  }
  writeTree(home(), tree)
  writeTree(project(), {
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'gamma@mkt': true } }),
    '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { 'delta@mkt': false } }),
  })
}

/** Every path under `dir` with its modification time and size. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => {
      const stat = statSync(join(dir, path))
      return `${path} ${stat.mtimeMs} ${stat.size}`
    })
    .sort()
}

describe('plugins installed in Claude Code', () => {
  test('appear in a chat without a project as Claude Code loads them', async () => {
    fixture()
    const plugins = await discoverPlugins({ homeDir: home(), includeBundled: false })
    const byName = new Map(plugins.map((plugin) => [plugin.manifest.name, plugin]))
    expect([...byName.keys()]).toEqual(['alpha', 'delta', 'lsp', 'plain', 'rel', 'shadow'])
    expect(byName.get('alpha')).toMatchObject({ dir: cache('alpha'), scope: 'global' })
    expect(byName.get('alpha')!.provides.skills).toEqual(['alpha-skill'])
    // A relative-path marketplace plugin loads from the marketplace, with no install record.
    expect(byName.get('rel')!.dir).toBe(join(market(), 'plugins/rel'))
    // A plugin without a manifest is its marketplace entry, named by it.
    expect(byName.get('lsp')!.provides.lspServers).toEqual(['go'])
    expect(byName.get('shadow')!.dir).toBe(join(home(), '.localix/plugins/shadow'))
  })

  test('in a project, follow its settings and its own installs', async () => {
    fixture()
    const plugins = await discoverPlugins({
      homeDir: home(),
      cwd: project(),
      projectId: 'p1',
      includeBundled: false,
    })
    const names = plugins.map((plugin) => plugin.manifest.name)
    expect(names).toContain('gamma')
    expect(names).not.toContain('delta')
    expect(plugins.find((plugin) => plugin.manifest.name === 'gamma')).toMatchObject({
      scope: 'project',
      projectId: 'p1',
    })
    expect(plugins.find((plugin) => plugin.manifest.name === 'alpha')!.projectId).toBe('p1')
  })

  test('records which settings file turned each one on', async () => {
    fixture()
    const installs = await readClaudeCodeInstalls({ homeDir: home(), cwd: project() })
    expect(installs.map(({ id, scope, enabledBy }) => ({ id, scope, enabledBy }))).toEqual([
      { id: 'alpha@mkt', scope: 'global', enabledBy: 'user' },
      { id: 'gamma@mkt', scope: 'project', enabledBy: 'project' },
      { id: 'lsp@mkt', scope: 'global', enabledBy: 'user' },
      { id: 'plain@mkt', scope: 'global', enabledBy: undefined },
      { id: 'quiet@mkt', scope: 'global', enabledBy: undefined },
      { id: 'rel@mkt', scope: 'global', enabledBy: 'user' },
      { id: 'shadow@mkt', scope: 'global', enabledBy: 'user' },
    ])
  })

  test('are read, never written', async () => {
    fixture()
    const before = snapshot(join(home(), '.claude'))
    await discoverPlugins({
      homeDir: home(),
      cwd: project(),
      projectId: 'p1',
      includeBundled: false,
    })
    expect(snapshot(join(home(), '.claude'))).toEqual(before)
  })

  test('nothing is read when Claude Code has no install record or settings', async () => {
    writeTree(home(), { '.localix/plugins/own/.claude-plugin/plugin.json': manifest('own') })
    const plugins = await discoverPlugins({ homeDir: home(), includeBundled: false })
    expect(plugins.map((plugin) => plugin.manifest.name)).toEqual(['own'])
  })
})
