import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { PluginCatalog, PluginCatalogEntry } from './catalog'
import type { PluginCommandSpec } from './contracts'
import { loadManifest } from './manifest-load'
import { diskPluginHost, testSessionSkill } from './kit/testing'
import { listCatalogCommandSpecs, pluginSkillCommandSpecs } from './plugin-skills'

/**
 * A plugin's `SKILL.md` skills run as `/<plugin>:<skill>`, as in Claude Code. Before this, only the
 * model could reach them: the composer never listed them and the slash path never matched them.
 */
const root = tempDirPerTest('plugin-skills-')

const skill = (fm: string, body: string) => `---\n${fm}\n---\n\n${body}\n`

function catalogOf(entries: PluginCatalogEntry[]): PluginCatalog {
  return {
    all: entries,
    enabled: entries.filter((entry) => entry.enabled),
    awaitingConsent: [],
    find: (name) => entries.find((entry) => entry.plugin.manifest.name === name),
  }
}

async function fixture(): Promise<PluginCatalog> {
  const dir = join(root(), 'kit')
  writeTree(dir, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'kit', description: 'kit plugin' }),
    'skills/review/SKILL.md': skill(
      'description: Review from ${CLAUDE_PLUGIN_ROOT}\nallowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/check *)',
      'Run ${CLAUDE_PLUGIN_ROOT}/bin/check on $ARGUMENTS.',
    ),
    'skills/renamed/SKILL.md': skill('name: fancy\ndescription: Fancy', 'Be fancy.'),
    'skills/prefixed/SKILL.md': skill('name: kit:already\ndescription: Already', 'Once.'),
    'skills/hidden/SKILL.md': skill(
      'description: Background\nuser-invocable: false',
      'Model-only background.',
    ),
  })
  const off = join(root(), 'off')
  writeTree(off, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'off', description: 'off plugin' }),
    'skills/nope/SKILL.md': skill('description: Nope', 'Never.'),
  })
  const entry = async (path: string, enabled: boolean): Promise<PluginCatalogEntry> => ({
    plugin: await loadManifest(path, 'global', ''),
    state: undefined,
    enabled,
    awaitingConsent: false,
  })
  return catalogOf([await entry(dir, true), await entry(off, false)])
}

const list = (catalog: PluginCatalog) =>
  listCatalogCommandSpecs(catalog, {
    projectId: '',
    projectDir: join(root(), 'project'),
    homeDir: join(root(), 'home'),
    modCommands: [],
    pluginHost: diskPluginHost(join(root(), 'home')),
  })

describe('plugin skills as slash commands', () => {
  // Kit wins: a plugin skill is `/<plugin>:<folder>`, whatever its frontmatter `name` says (Localix
  // used to take the `name`).
  test('are named /<plugin>:<folder>', async () => {
    const names = (await list(await fixture())).map((spec) => spec.fullName)
    expect(names).toContain('kit:review')
    expect(names).toContain('kit:renamed')
    expect(names).toContain('kit:prefixed')
    expect(names).not.toContain('kit:fancy')
  })

  test('the menu leaves out a model-only skill and a disabled plugin', async () => {
    const names = (await list(await fixture())).map((spec) => spec.fullName)
    expect(names).not.toContain('kit:hidden')
    expect(names).not.toContain('off:nope')
  })

  test('a listed skill keeps its own name and the description the kit reads', async () => {
    const specs = await list(await fixture())
    expect(specs.find((spec) => spec.fullName === 'kit:renamed')).toMatchObject({
      pluginName: 'kit',
      name: 'renamed',
      description: 'Fancy',
      args: [],
    })
  })

  test('a command of the same full name keeps its entry; a command named after its plugin too', () => {
    const row = (name: string) => testSessionSkill(name, '', { plugin: 'kit' })
    const taken: PluginCommandSpec[] = [
      { pluginName: 'kit', name: 'fancy', fullName: 'kit:fancy', description: 'cmd', args: [] },
      { pluginName: 'kit', name: 'kit', fullName: 'kit', description: 'cmd', args: [] },
    ]
    const specs = pluginSkillCommandSpecs([row('fancy'), row('kit'), row('x')], taken)
    expect(specs.map((spec) => spec.fullName)).toEqual(['kit:x'])
    expect(specs[0]).toMatchObject({ pluginName: 'kit', name: 'x' })
  })

  // Kit wins (checked against Claude Code 2.1.319): within one plugin a command file wins a name its
  // skill shares, where Localix listed the skill.
  test('a skill and a command of the same name list once, as the command', async () => {
    const dir = join(root(), 'dup')
    writeTree(dir, {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'dup', description: 'dup plugin' }),
      'commands/review.md': skill('description: The command', 'DUP-COMMAND'),
      'commands/other.md': skill('description: Only a command', 'OTHER'),
      'skills/review/SKILL.md': skill('description: The skill', 'DUP-SKILL'),
    })
    const catalog = catalogOf([
      {
        plugin: await loadManifest(dir, 'global', ''),
        state: undefined,
        enabled: true,
        awaitingConsent: false,
      },
    ])
    const specs = await list(catalog)
    const review = specs.filter((spec) => spec.fullName === 'dup:review')
    expect(review.map((spec) => spec.description)).toEqual(['The command'])
    expect(specs.map((spec) => spec.fullName)).toContain('dup:other')
  })
})
