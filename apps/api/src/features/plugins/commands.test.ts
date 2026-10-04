import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { discoverPlugins } from './discovery'
import { loadEnabledPlugins } from './loader'
import { buildPluginCatalog } from './catalog'
import { validateSkillFile } from '../agent-core/skill-validate'
import { validatePlugin } from './validate'

/** A repo with NO state rows — exercises the default-enable path. */
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

let dir: string
let home: string
let bundled: string
const prevEnv = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-cmds-'))
  home = await fs.mkdtemp(join(tmpdir(), 'plugin-cmds-home-'))

  // A project plugin that declares an inline rich command with args.
  const cmd = join(dir, '.localix', 'plugins', 'cmd-plugin')
  await fs.mkdir(cmd, { recursive: true })
  await fs.writeFile(
    join(cmd, 'plugin.json'),
    JSON.stringify({
      name: 'cmd-plugin',
      version: '1.0.0',
      description: 'declares a command',
      commands: [
        {
          name: 'do',
          description: 'do a thing',
          args: [
            { name: 'mode', type: 'choice', options: [{ value: 'a' }, { value: 'b' }] },
            { name: 'text', type: 'text' },
          ],
          prompt: 'Do ${mode} with ${text}',
        },
      ],
    }),
  )

  // A separate bundled root with a command-only plugin (default-enable candidate).
  bundled = await fs.mkdtemp(join(tmpdir(), 'plugin-bundled-'))
  const b = join(bundled, 'builtin-cmd')
  await fs.mkdir(b, { recursive: true })
  await fs.writeFile(
    join(b, 'plugin.json'),
    JSON.stringify({
      name: 'builtin-cmd',
      version: '1.0.0',
      description: 'bundled command-only',
      commands: [{ name: 'go', description: 'go', prompt: 'Go now' }],
    }),
  )
  // …and it bundles a skill — must load by default (no DB row) so its macro can use it.
  await fs.mkdir(join(b, 'skills', 'helper'), { recursive: true })
  await fs.writeFile(
    join(b, 'skills', 'helper', 'SKILL.md'),
    '---\nname: helper\ndescription: a bundled helper skill\n---\n\nHelp.',
  )
  // A skill whose description references ${CLAUDE_PLUGIN_ROOT} — verifies loader substitution.
  await fs.mkdir(join(b, 'skills', 'rooted'), { recursive: true })
  await fs.writeFile(
    join(b, 'skills', 'rooted', 'SKILL.md'),
    '---\nname: rooted\ndescription: Lives in ${CLAUDE_PLUGIN_ROOT}/skills/rooted\n---\n\nContent at ${CLAUDE_PLUGIN_ROOT}.',
  )
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = bundled

  // A plugin with SKILL.md at its root (single-skill plugin, no skills/ dir).
  const singleSkill = join(dir, '.localix', 'plugins', 'single-skill-plugin')
  await fs.mkdir(singleSkill, { recursive: true })
  await fs.writeFile(
    join(singleSkill, 'plugin.json'),
    JSON.stringify({
      name: 'single-skill-plugin',
      version: '1.0.0',
      description: 'root SKILL.md',
    }),
  )
  await fs.writeFile(
    join(singleSkill, 'SKILL.md'),
    '---\nname: root-skill\ndescription: Root skill\n---\n\nI live at the plugin root.',
  )

  // A plugin whose manifest tries to escape its own directory (security).
  const escaper = join(dir, '.localix', 'plugins', 'escaper')
  await fs.mkdir(join(escaper, 'skills', 'safe'), { recursive: true })
  await fs.writeFile(
    join(escaper, 'plugin.json'),
    JSON.stringify({
      name: 'escaper',
      version: '1.0.0',
      description: 'tries to escape',
      skills: ['../../../evil-skills', './skills'],
    }),
  )
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
  if (prevEnv === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevEnv
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
  await fs.rm(bundled, { recursive: true, force: true })
})

describe('plugin commands + bundled discovery', () => {
  it('parses inline rich command declarations from the manifest', async () => {
    const found = await discoverPlugins({ cwd: dir, projectId: 'p1', homeDir: home })
    const p = found.find((x) => x.manifest.name === 'cmd-plugin')
    expect(p).toBeDefined()
    expect(p!.commands).toHaveLength(1)
    const c = p!.commands[0]
    expect(c.name).toBe('do')
    expect(c.prompt).toContain('${mode}')
    expect(c.args.map((a) => `${a.name}:${a.type}`)).toEqual(['mode:choice', 'text:text'])
    expect(c.args[0].options?.map((o) => o.value)).toEqual(['a', 'b'])
    // and the name shows up in the static provides list
    expect(p!.provides.commands).toContain('do')
  })

  it('discovers a bundled command-only plugin and tags it bundled', async () => {
    const found = await discoverPlugins({ homeDir: home })
    const b = found.find((x) => x.manifest.name === 'builtin-cmd')
    expect(b).toBeDefined()
    expect(b!.bundled).toBe(true)
    expect(b!.provides.hasNativeTools).toBe(false) // → default-enabled by the service rule
    expect(b!.commands[0].name).toBe('go')
  })

  it('buildPluginCatalog fuses discovery + state + the enable rule in one place', async () => {
    const catalog = await buildPluginCatalog({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    const entry = catalog.find('builtin-cmd', '')
    expect(entry).toBeDefined()
    expect(entry!.state).toBeUndefined() // no DB row…
    expect(entry!.enabled).toBe(true) // …yet default-on (bundled, command-only)
    // `.enabled` is exactly the subset of `.all` that resolved enabled.
    expect(catalog.enabled.every((e) => e.enabled)).toBe(true)
    expect(catalog.enabled.some((e) => e.plugin.manifest.name === 'builtin-cmd')).toBe(true)
  })

  it('loadEnabledPlugins loads a bundled command-only plugin (no DB row) WITH its skills', async () => {
    // Regression: the loader once required a DB row, so a default-enabled bundled
    // plugin's bundled skills never loaded even though its command dispatched.
    const loaded = await loadEnabledPlugins({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    expect(loaded.loaded.some((p) => p.name === 'builtin-cmd')).toBe(true)
    expect(loaded.skills.some((s) => s.name === 'helper')).toBe(true)
  })

  it('loader substitutes ${CLAUDE_PLUGIN_ROOT} in skill description and content', async () => {
    const loaded = await loadEnabledPlugins({
      availability: UNDECIDED,
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
    // When loaded (default-enabled for code-free plugins), the root skill appears.
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
