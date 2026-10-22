import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { PluginCatalog, PluginCatalogEntry } from './catalog'
import type { PluginCommandSpec } from './contracts'
import { loadManifest } from './manifest-load'
import {
  listCatalogCommandSpecs,
  pluginSkillCommandSpecs,
  pluginSkillFullName,
  readCatalogPluginSkills,
} from './plugin-skills'

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

const read = async (catalog: PluginCatalog) =>
  readCatalogPluginSkills(catalog, {
    projectId: '',
    projectDir: join(root(), 'project'),
    homeDir: join(root(), 'home'),
  })

describe('plugin skills as slash commands', () => {
  test('are named /<plugin>:<skill>, by folder or frontmatter name, never prefixed twice', async () => {
    const skills = await read(await fixture())
    expect(skills.map((s) => s.fullName).sort()).toEqual([
      'kit:already',
      'kit:fancy',
      'kit:hidden',
      'kit:review',
    ])
    expect(skills.find((s) => s.fullName === 'kit:already')?.shortName).toBe('already')
    expect(pluginSkillFullName('kit', 'KIT:x')).toBe('KIT:x')
  })

  test('read the text the model would load, with the plugin path substituted', async () => {
    const skills = await read(await fixture())
    const review = skills.find((s) => s.fullName === 'kit:review')!
    const pluginDir = join(root(), 'kit')
    expect(review.pluginDir).toBe(pluginDir)
    expect(review.skill.pluginName).toBe('kit')
    expect(review.skill.content).toContain(`Run ${pluginDir}/bin/check on $ARGUMENTS.`)
    expect(review.skill.description).toBe(`Review from ${pluginDir}`)
    expect(review.skill.allowedTools).toEqual([`Bash(${pluginDir}/bin/check *)`])
  })

  test('the composer lists them beside commands, without model-only skills or duplicates', async () => {
    const skills = await read(await fixture())
    const taken: PluginCommandSpec[] = [
      { pluginName: 'kit', name: 'fancy', fullName: 'kit:fancy', description: 'cmd', args: [] },
    ]
    const specs = pluginSkillCommandSpecs(skills, taken)
    expect(specs.map((spec) => spec.fullName).sort()).toEqual(['kit:already', 'kit:review'])
    // A command named after its plugin is listed as `/kit` and also answers `/kit:kit` first.
    const sameName = pluginSkillCommandSpecs(
      [{ ...skills.find((s) => s.fullName === 'kit:review')!, fullName: 'kit:kit' }],
      [{ pluginName: 'kit', name: 'kit', fullName: 'kit', description: 'cmd', args: [] }],
    )
    expect(sameName).toEqual([])
    expect(specs.find((spec) => spec.fullName === 'kit:review')).toMatchObject({
      pluginName: 'kit',
      name: 'review',
      args: [],
    })
  })

  test("the scope's command list carries them after the plugin commands", async () => {
    const specs = await listCatalogCommandSpecs(await fixture(), {
      projectId: '',
      projectDir: join(root(), 'project'),
      homeDir: join(root(), 'home'),
      modCommands: [],
    })
    expect(specs.map((spec) => spec.fullName)).toContain('kit:review')
    expect(specs.map((spec) => spec.fullName)).not.toContain('off:nope')
  })
})
