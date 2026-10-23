import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED, type AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { discoverPlugins } from './discovery'
import { loadEnabledPlugins } from './loader'
import { buildPluginCatalog } from './catalog'
import { validateSkillFile } from '../agent-core/skill-validate'
import { validatePlugin } from './validate'

/** A repo with NO state rows: only the availability decides. */
const emptyRepo: CapabilitySourceRepository = {
  listForScope: async () => [],
  get: async () => null,
  upsert: async () => ({
    id: 'x',
    userId: 'u',
    projectId: '',
    name: 'x',
    enabled: false,
    config: {},
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  patchConfig: async (_userId, projectId, name, patch) => ({
    id: 'x',
    userId: 'u',
    projectId,
    name,
    enabled: false,
    config: patch,
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  remove: async () => {},
}

/** Every plugin switched on, as a rule allowing it would. */
const ALL_ON: AvailabilityReader = { effectFor: () => 'allow' }

let dir: string
let home: string

/** Write a plugin's `.claude-plugin/plugin.json`. */
async function writeManifest(pluginDir: string, manifest: Record<string, unknown>) {
  await fs.mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-cmds-'))
  home = await fs.mkdtemp(join(tmpdir(), 'plugin-cmds-home-'))

  // A project plugin that declares a command inline, in Claude Code's `commands` object map.
  const cmd = join(dir, '.localix', 'plugins', 'cmd-plugin')
  await writeManifest(cmd, {
    name: 'cmd-plugin',
    version: '1.0.0',
    description: 'declares a command',
    commands: {
      do: { description: 'do a thing', argumentHint: '[mode] [text]', content: 'Do $ARGUMENTS' },
    },
  })

  // A plugin with a skill whose description references ${CLAUDE_PLUGIN_ROOT}.
  const rooted = join(home, '.localix', 'plugins', 'rooted-plugin')
  await fs.mkdir(join(rooted, 'skills', 'rooted'), { recursive: true })
  await fs.writeFile(
    join(rooted, 'skills', 'rooted', 'SKILL.md'),
    '---\nname: rooted\ndescription: Lives in ${CLAUDE_PLUGIN_ROOT}/skills/rooted\n---\n\nContent at ${CLAUDE_PLUGIN_ROOT}.',
  )

  // A plugin with SKILL.md at its root (single-skill plugin, no skills/ dir).
  const singleSkill = join(dir, '.localix', 'plugins', 'single-skill-plugin')
  await writeManifest(singleSkill, {
    name: 'single-skill-plugin',
    version: '1.0.0',
    description: 'root SKILL.md',
  })
  await fs.writeFile(
    join(singleSkill, 'SKILL.md'),
    '---\nname: root-skill\ndescription: Root skill\n---\n\nI live at the plugin root.',
  )

  // A plugin whose manifest tries to escape its own directory (security).
  const escaper = join(dir, '.localix', 'plugins', 'escaper')
  await fs.mkdir(join(escaper, 'skills', 'safe'), { recursive: true })
  await writeManifest(escaper, {
    name: 'escaper',
    version: '1.0.0',
    description: 'tries to escape',
    skills: ['../../../evil-skills', './skills'],
  })
  await fs.writeFile(
    join(escaper, 'skills', 'safe', 'SKILL.md'),
    '---\nname: safe\ndescription: in-dir skill\n---\n\nok',
  )
  // The escape target sits OUTSIDE the plugin dir (under the project root).
  await fs.mkdir(join(dir, 'evil-skills', 'pwned'), { recursive: true })
  await fs.writeFile(
    join(dir, 'evil-skills', 'pwned', 'SKILL.md'),
    '---\nname: pwned\ndescription: should never be read\n---\n\nx',
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

describe('plugin commands and skills', () => {
  it('reads a command declared inline in the manifest commands map', async () => {
    const found = await discoverPlugins({ cwd: dir, projectId: 'p1', homeDir: home })
    const p = found.find((x) => x.manifest.name === 'cmd-plugin')
    expect(p).toBeDefined()
    expect(p!.commands).toHaveLength(1)
    const c = p!.commands[0]
    expect(c.name).toBe('do')
    expect(c.description).toBe('do a thing')
    expect(c.argumentHint).toBe('[mode] [text]')
    expect(c.prompt).toBe('Do $ARGUMENTS')
    // and the name shows up in the static provides list
    expect(p!.provides.commands).toContain('do')
  })

  it('buildPluginCatalog leaves a plugin nobody has ruled on off (untrusted asks first)', async () => {
    const catalog = await buildPluginCatalog({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    const entry = catalog.find('rooted-plugin', '')
    expect(entry).toBeDefined()
    expect(entry!.state).toBeUndefined()
    expect(entry!.enabled).toBe(false)
    expect(catalog.enabled.some((e) => e.plugin.manifest.name === 'rooted-plugin')).toBe(false)
  })

  it('loader substitutes ${CLAUDE_PLUGIN_ROOT} in skill description and content', async () => {
    const loaded = await loadEnabledPlugins({
      availability: ALL_ON,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    const rooted = loaded.skills.find((s) => s.name === 'rooted')
    expect(rooted).toBeDefined()
    // ${CLAUDE_PLUGIN_ROOT} in description should be replaced with the actual dir path.
    expect(rooted!.description).not.toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(rooted!.description).toContain('/skills/rooted')
    // Same substitution in content.
    expect(rooted!.content).not.toContain('${CLAUDE_PLUGIN_ROOT}')
  })

  it("confines a plugin manifest's skill paths to its own directory", async () => {
    const found = await discoverPlugins({ cwd: dir, projectId: 'p1', homeDir: home })
    const e = found.find((x) => x.manifest.name === 'escaper')!
    expect(e.provides.skills).toContain('safe') // in-dir skill kept
    expect(e.provides.skills).not.toContain('pwned') // ../escape dropped
  })

  it('validatePlugin flags a command with an empty prompt', async () => {
    const found = await discoverPlugins({ cwd: dir, projectId: 'p1', homeDir: home })
    const p = found.find((x) => x.manifest.name === 'cmd-plugin')!
    // Clean plugin → no errors.
    expect(validatePlugin(p).errors).toHaveLength(0)
    // Tamper with a command prompt to simulate an empty one.
    const tampered = { ...p, commands: [{ ...p.commands[0], prompt: '' }] }
    expect(validatePlugin(tampered).warnings.length).toBeGreaterThan(0)
  })

  it('validateSkillFile warns on unrecognized context: value', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-ctx-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(
      path,
      '---\nname: bad-ctx\ndescription: skill.\ncontext: isolate\n---\n\nBody here.',
    )
    const v = await validateSkillFile(path)
    expect(v.errors).toHaveLength(0)
    expect(v.warnings.some((w) => w.includes('"isolate"') && w.includes('context'))).toBe(true)
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('validateSkillFile warns when disable-model-invocation + user-invocable:false (dead code)', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-dead-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(
      path,
      '---\nname: dead\ndescription: dead.\ndisable-model-invocation: true\nuser-invocable: false\n---\n\nBody.',
    )
    const v = await validateSkillFile(path)
    expect(v.warnings.some((w) => w.includes('dead code'))).toBe(true)
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('validateSkillFile warns on unrecognized effort: value', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-effort-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(path, '---\nname: effort\ndescription: skill.\neffort: turbo\n---\n\nBody.')
    const v = await validateSkillFile(path)
    expect(v.warnings.some((w) => w.includes('"turbo"') && w.includes('effort'))).toBe(true)
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('validateSkillFile warns when agent: is set without context: fork', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-agent-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(
      path,
      '---\nname: orphan-agent\ndescription: skill.\nagent: Explore\n---\n\nBody.',
    )
    const v = await validateSkillFile(path)
    expect(v.warnings.some((w) => w.includes('agent:') && w.includes('context: fork'))).toBe(true)
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('validateSkillFile warns on context:fork with a very short body', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-fork-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(
      path,
      '---\nname: tiny-fork\ndescription: forks a subagent.\ncontext: fork\n---\n\nToo short.',
    )
    const v = await validateSkillFile(path)
    expect(v.errors).toHaveLength(0)
    expect(v.warnings.some((w) => w.includes('context: fork') && w.includes('short body'))).toBe(
      true,
    )
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('validateSkillFile warns on a SKILL.md without frontmatter (name/description optional per CC spec)', async () => {
    const skillDir = await fs.mkdtemp(join(tmpdir(), 'sk-'))
    const path = join(skillDir, 'SKILL.md')
    await fs.writeFile(path, '# just a heading\n\nbody only')
    const v = await validateSkillFile(path)
    // name + description both absent → 2 warnings, but NOT an error (CC: dir basename fallback)
    expect(v.errors).toHaveLength(0)
    expect(v.warnings.length).toBeGreaterThan(0)
    await fs.rm(skillDir, { recursive: true, force: true })
  })

  it('single-skill plugin: auto-discovers SKILL.md at the plugin root', async () => {
    const found = await discoverPlugins({ cwd: dir, projectId: 'p1', homeDir: home })
    const plugin = found.find((p) => p.manifest.name === 'single-skill-plugin')
    expect(plugin).toBeDefined()
    // The plugin root should be in skillDirs (since it has a SKILL.md there).
    expect(plugin!.entrypoints.skillDirs.some((d) => d.endsWith('single-skill-plugin'))).toBe(true)
    const catalog = await buildPluginCatalog({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: 'p1',
      cwd: dir,
      homeDir: home,
    })
    const entry = catalog.all.find((e) => e.plugin.manifest.name === 'single-skill-plugin')
    expect(entry).toBeDefined()
  })
})
