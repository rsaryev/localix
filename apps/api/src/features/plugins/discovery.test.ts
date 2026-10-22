import { describe, it, expect, beforeAll, afterAll, spyOn } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MANIFEST_DIR as CLAUDE_CODE_DIR,
  MANIFEST_FILE as CLAUDE_CODE_PLUGIN_MANIFEST,
} from '@localixai/claude-plugin'

import { resolve } from 'node:path'
import {
  discoverPlugins,
  discoverBundledPlugins,
  loadManifest,
  resolveEntrypoints,
  bundledPluginsRoot,
  pluginInstallRoot,
} from './discovery'

describe('plugin path resolvers', () => {
  it('bundledPluginsRoot self-locates a plugins/ root (no env)', () => {
    // Pure self-location from the module URL — no LOCALIX_BUNDLED_PLUGINS_DIR.
    const root = bundledPluginsRoot()
    expect(root.length).toBeGreaterThan(0)
    expect(root.endsWith('plugins')).toBe(true)
  })
  it('pluginInstallRoot: project+cwd → cwd, else home', () => {
    expect(pluginInstallRoot('project', '/work', '/home/u')).toBe(
      join(resolve('/work'), '.localix/plugins'),
    )
    expect(pluginInstallRoot('global', null, '/home/u')).toBe(join('/home/u', '.localix/plugins'))
    expect(pluginInstallRoot('project', null, '/home/u')).toBe(join('/home/u', '.localix/plugins'))
  })

  it('does not copy the unmarked source fallback into a fresh global home', async () => {
    const previous = process.env.LOCALIX_BUNDLED_PLUGINS_DIR
    const isolatedHome = await fs.mkdtemp(join(tmpdir(), 'plugins-source-fallback-home-'))
    delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
    try {
      const sourcePlugins = await discoverBundledPlugins()
      expect(sourcePlugins.length).toBeGreaterThan(0)

      const discovered = await discoverPlugins({ cwd: null, homeDir: isolatedHome })
      expect(discovered).toEqual([])
      expect(
        await fs
          .stat(join(isolatedHome, '.localix', 'plugins'))
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
      else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = previous
      await fs.rm(isolatedHome, { recursive: true, force: true })
    }
  })
})

let dir: string
let home: string
// A fixture Claude Code home with no registry — keeps the default discovery calls
// hermetic (the dedicated eco test passes the populated fixture explicitly).
beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugins-'))
  home = await fs.mkdtemp(join(tmpdir(), 'plugins-home-'))

  const noProjectOnly = join(home, '.localix', 'plugins', 'no-project-only')
  await fs.mkdir(noProjectOnly, { recursive: true })
  await fs.writeFile(
    join(noProjectOnly, 'plugin.json'),
    JSON.stringify({ name: 'no-project-only', version: '1.0.0' }),
  )

  // A full-featured plugin under the project's .localix/plugins.
  const weather = join(dir, '.localix', 'plugins', 'weather')
  await fs.mkdir(join(weather, 'tools'), { recursive: true })
  await fs.mkdir(join(weather, 'skills', 'forecast'), { recursive: true })
  await fs.writeFile(
    join(weather, 'plugin.json'),
    JSON.stringify({
      name: 'weather',
      version: '1.2.3',
      description: 'Weather tools',
      tools: './tools/index.mjs',
      config: { API_KEY: { type: 'string', secret: true, required: true } },
      mcpServers: { wx: { command: 'echo hi' } },
    }),
  )
  await fs.writeFile(join(weather, 'tools', 'index.mjs'), 'export const tools = []\n')
  await fs.writeFile(
    join(weather, 'skills', 'forecast', 'SKILL.md'),
    '---\nname: forecast\ndescription: Forecast the weather\n---\n\nDo the forecast.',
  )

  // Complete plugin trees exist at these names during an atomic bundled update,
  // but they are transaction artifacts rather than independently installed plugins.
  for (const [name, manifestName] of [
    ['.sync-sample-123-staging', 'sync-staging-artifact'],
    ['.sync-backup-sample-123-backup', 'sync-backup-artifact'],
    ['.extension-publish-123', 'publication-artifact'],
  ]) {
    const artifact = join(dir, '.localix', 'plugins', name)
    await fs.mkdir(artifact, { recursive: true })
    await fs.writeFile(
      join(artifact, 'plugin.json'),
      JSON.stringify({ name: manifestName, version: '1.0.0' }),
    )
  }

  // A directory with neither a manifest nor any component dir must be ignored.
  await fs.mkdir(join(dir, '.localix', 'plugins', 'not-a-plugin'), {
    recursive: true,
  })

  // A plugin whose `skills` path points DIRECTLY at a skill dir (SKILL.md inside),
  // not a parent of subdirs — Claude Code's `skills: ["./path/to/skill"]` form.
  const directSkill = join(dir, '.localix', 'plugins', 'direct-skill')
  await fs.mkdir(join(directSkill, 'pack', 'designer'), { recursive: true })
  await fs.writeFile(
    join(directSkill, 'plugin.json'),
    JSON.stringify({
      name: 'direct-skill',
      version: '1.0.0',
      description: 'direct skill path',
      skills: ['./pack/designer'],
    }),
  )
  await fs.writeFile(
    join(directSkill, 'pack', 'designer', 'SKILL.md'),
    '---\nname: designer\ndescription: Design things\n---\n\nDesign it.',
  )

  // A manifest-LESS plugin (Claude Code parity): only a skills/ dir, name = dir basename.
  const noManifest = join(dir, '.localix', 'plugins', 'session-report')
  await fs.mkdir(join(noManifest, 'skills', 'report'), { recursive: true })
  await fs.writeFile(
    join(noManifest, 'skills', 'report', 'SKILL.md'),
    '---\nname: report\ndescription: Write a session report\n---\n\nReport.',
  )

  // A plugin with a broken manifest still surfaces (with an error).
  const broken = join(dir, '.localix', 'plugins', 'broken')
  await fs.mkdir(broken, { recursive: true })
  await fs.writeFile(join(broken, 'plugin.json'), '{ not valid json')

  // A Claude Code plugin, loaded in place as an install leaves it, components at root.
  const cc = join(dir, '.localix', 'plugins', 'cc-plugin')
  await fs.mkdir(join(cc, CLAUDE_CODE_DIR), { recursive: true })
  await fs.mkdir(join(cc, 'skills', 'review'), { recursive: true })
  await fs.writeFile(
    join(cc, CLAUDE_CODE_PLUGIN_MANIFEST),
    JSON.stringify({
      name: 'cc-plugin',
      version: '2.0.0',
      description: 'Claude Code layout',
    }),
  )
  await fs.writeFile(
    join(cc, 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: Review code\n---\n\nReview.',
  )
  // Claude Code flat-file command in the default commands/ dir.
  await fs.mkdir(join(cc, 'commands'), { recursive: true })
  await fs.writeFile(
    join(cc, 'commands', 'deploy.md'),
    '---\ndescription: Deploy the app\n---\n\nDeploy $ARGUMENTS to production.',
  )
  // A command with argument-hint and allowed-tools frontmatter.
  await fs.writeFile(
    join(cc, 'commands', 'hinted.md'),
    '---\ndescription: Run with hint\nargument-hint: "[env] [tag]"\nallowed-tools: Bash Read\n---\n\nRun $ARGUMENTS.',
  )
  // A command with disallowed-tools (CC parity with skill disallowed-tools).
  await fs.writeFile(
    join(cc, 'commands', 'restricted.md'),
    '---\ndescription: Read-only command\ndisallowed-tools: Write Edit Bash\n---\n\nAnalyze only.',
  )
  // Claude Code agent files in the default agents/ dir. `reviewer` declares a CC
  // `tools` allowlist (mapped to engine tools); `webber` lists only unmapped tools.
  await fs.mkdir(join(cc, 'agents'), { recursive: true })
  await fs.writeFile(
    join(cc, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code\ntools: Glob, Grep, Read, WebFetch\nmodel: sonnet\ndisallowedTools: Write, Edit\n---\n\nYou are a meticulous code reviewer.',
  )
  await fs.writeFile(
    join(cc, 'agents', 'webber.md'),
    '---\nname: webber\ndescription: Searches the web\ntools: WebFetch, WebSearch\n---\n\nYou search the web.',
  )
  // An agent using the YAML quoted-array form: tools: ["Read", "Grep"]
  await fs.writeFile(
    join(cc, 'agents', 'quoted-tools.md'),
    '---\nname: quoted-tools\ndescription: Uses quoted YAML array\ntools: ["Read", "Grep", "Bash"]\n---\n\nUses quoted tools.',
  )
  // An agent using CC `skills:` frontmatter to preload skill names.
  await fs.writeFile(
    join(cc, 'agents', 'pinned.md'),
    '---\nname: pinned\ndescription: Agent with pinned skills\nskills: review, security-scan\n---\n\nYou run with pinned skills.',
  )
  // An agent using CC `effort:` and `when-to-use:` frontmatter.
  await fs.writeFile(
    join(cc, 'agents', 'analyst.md'),
    '---\nname: analyst\ndescription: Analyzes data.\nwhen-to-use: Use when analyzing logs or metrics.\neffort: high\n---\n\nYou are a data analyst.',
  )
  // An agent using newer CC tool names: AskUserQuestion→ask, EnterPlanMode unmapped.
  await fs.writeFile(
    join(cc, 'agents', 'plan-agent.md'),
    '---\nname: plan-agent\ndescription: Plans tasks.\ntools: AskUserQuestion EnterPlanMode Read\n---\n\nYou plan.',
  )
  // An agent with `tools: *` (wildcard = all tools → undefined).
  await fs.writeFile(
    join(cc, 'agents', 'wildcard.md'),
    '---\nname: wildcard\ndescription: Wildcard tools.\ntools: *\n---\n\nAll tools.',
  )

  // A Claude Code ecosystem install: ~/.claude/plugins with an installed_plugins.json
  // registry pointing at a cached plugin dir (Claude Code manifest layout).
  const ccHome = join(dir, 'claude-home')
  const cachedDir = join(ccHome, 'cache', 'official', 'eco-plugin', '1.0.0')
  await fs.mkdir(join(cachedDir, CLAUDE_CODE_DIR), { recursive: true })
  await fs.writeFile(
    join(cachedDir, CLAUDE_CODE_PLUGIN_MANIFEST),
    JSON.stringify({
      name: 'eco-plugin',
      version: '1.0.0',
      description: 'From the Claude Code ecosystem',
    }),
  )
  await fs.writeFile(
    join(ccHome, 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'eco-plugin@official': [{ scope: 'user', installPath: cachedDir, version: '1.0.0' }],
      },
    }),
  )
})

afterAll(async () => {
  await Promise.all([
    fs.rm(dir, { recursive: true, force: true }),
    fs.rm(home, { recursive: true, force: true }),
  ])
})

describe('discoverPlugins', () => {
  it('a personal plugin stays visible inside a project, keyed to it', async () => {
    const project = await discoverPlugins({
      cwd: dir,
      projectId: 'project-1',
      homeDir: home,
      includeBundled: false,
    })
    const noProject = await discoverPlugins({
      cwd: null,
      projectId: '',
      homeDir: home,
      includeBundled: false,
    })

    // Opening a project used to hide everything you had installed for yourself, with nothing
    // on screen saying so. Where a plugin lives decides who it travels with — a project's
    // copy ships with the repository — not whether its owner may see it. What it may DO is a
    // rule on the agent, and an unvetted plugin is still not imported until you allow it.
    const mine = project.find((plugin) => plugin.manifest.name === 'no-project-only')
    expect(mine).toBeDefined()
    // Keyed to the active project, so its config and rules belong where it is used rather
    // than being shared across every project at once.
    expect(mine?.projectId).toBe('project-1')
    expect(noProject.some((plugin) => plugin.manifest.name === 'no-project-only')).toBe(true)
  })

  it('discovers a project plugin and its static capabilities', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const weather = found.find((p) => p.manifest.name === 'weather')
    expect(weather).toBeDefined()
    expect(weather!.scope).toBe('project')
    expect(weather!.projectId).toBe('proj1')
    expect(weather!.manifest.version).toBe('1.2.3')
    expect(weather!.provides.hasNativeTools).toBe(true)
    expect(weather!.provides.skills).toContain('forecast')
    expect(weather!.provides.mcpServers).toContain('wx')
    expect(weather!.error).toBeUndefined()
  })

  it('ignores directories with neither a manifest nor a component dir', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    expect(found.find((p) => p.manifest.name === 'not-a-plugin')).toBeUndefined()
  })

  it('ignores atomic plugin-sync staging and backup directories', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
      includeBundled: false,
    })

    expect(found.find((plugin) => plugin.manifest.name === 'sync-staging-artifact')).toBeUndefined()
    expect(found.find((plugin) => plugin.manifest.name === 'sync-backup-artifact')).toBeUndefined()
    expect(found.find((plugin) => plugin.manifest.name === 'publication-artifact')).toBeUndefined()
  })

  it('discovers a skill when the manifest skills path points directly at a skill dir', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const ds = found.find((p) => p.manifest.name === 'direct-skill')
    expect(ds).toBeDefined()
    expect(ds!.provides.skills).toContain('designer')
  })

  it('discovers a manifest-less plugin from its component dirs (name = directory)', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const sr = found.find((p) => p.manifest.name === 'session-report')
    expect(sr).toBeDefined()
    expect(sr!.error).toBeUndefined()
    expect(sr!.provides.skills).toContain('report')
  })

  it('surfaces a plugin with an invalid manifest, carrying an error', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const broken = found.find((p) => p.dir.endsWith('/broken'))
    expect(broken).toBeDefined()
    expect(broken!.error).toBeTruthy()
  })

  it('discovers an imported Claude Code plugin from its native manifest', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    expect(cc).toBeDefined()
    expect(cc!.error).toBeUndefined()
    expect(cc!.manifest.version).toBe('2.0.0')
    // Components resolve from the plugin root.
    expect(cc!.provides.skills).toContain('review')
  })

  it('loads Claude Code flat-file commands from the default commands/ dir', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    expect(cc!.provides.commands).toContain('deploy')
    const deploy = cc!.commands.find((c) => c.name === 'deploy')
    expect(deploy?.description).toBe('Deploy the app')
    expect(deploy?.prompt).toContain('Deploy $ARGUMENTS to production.')
  })

  it('parses disallowed-tools from CC command files (CC parity with skills)', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const restricted = cc!.commands.find((c) => c.name === 'restricted')
    expect(restricted).toBeDefined()
    // Write, Edit, Bash are CC names → normalized to engine names write, edit, bash
    expect(restricted?.disallowedTools?.sort()).toEqual(['bash', 'edit', 'write'])
  })

  it('parses argument-hint and allowed-tools from CC command files', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const hinted = cc!.commands.find((c) => c.name === 'hinted')
    expect(hinted).toBeDefined()
    expect(hinted?.argumentHint).toBe('[env] [tag]')
    // CC tool names (Bash, Read) normalized to engine names (bash, read)
    expect(hinted?.allowedTools?.sort()).toEqual(['bash', 'read'])
  })

  it('loads Claude Code agent files from the default agents/ dir into worker roles', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const reviewer = cc!.agents.find((a) => a.name === 'reviewer')
    expect(reviewer).toBeDefined()
    expect(reviewer?.description).toBe('Reviews code')
    expect(reviewer?.prompt).toContain('meticulous code reviewer')
  })

  it('maps a Claude Code agent tools allowlist to engine tool names (read-only stays read-only)', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    // Glob+Grep→search (deduped), Read→read; WebFetch→research. No write/bash.
    expect(cc!.agents.find((a) => a.name === 'reviewer')?.tools?.sort()).toEqual([
      'read',
      'research',
      'search',
    ])
    // disallowedTools: Write, Edit → engine names (write, edit); model hint preserved.
    expect(cc!.agents.find((a) => a.name === 'reviewer')?.disallowedTools?.sort()).toEqual([
      'edit',
      'write',
    ])
    expect(cc!.agents.find((a) => a.name === 'reviewer')?.preferredModel).toBe('sonnet')
    // Both legacy CC network authorities converge on one composite capability.
    expect(cc!.agents.find((a) => a.name === 'webber')?.tools).toEqual(['research'])
    // YAML quoted-array form ["Read", "Grep", "Bash"] — inner quotes stripped.
    expect(cc!.agents.find((a) => a.name === 'quoted-tools')?.tools?.sort()).toEqual([
      'bash',
      'read',
      'search',
    ])
  })

  it('parses CC effort: and when-to-use: frontmatter in agent files', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const analyst = cc!.agents.find((a) => a.name === 'analyst')
    expect(analyst).toBeDefined()
    // when-to-use: appended to description
    expect(analyst?.description).toContain('Analyzes data.')
    expect(analyst?.description).toContain('Use when analyzing')
    // effort: parsed as preferredEffort
    expect((analyst as { preferredEffort?: string })?.preferredEffort).toBe('high')
  })

  it('maps newer CC tool names (AskUserQuestion→ask); an unmapped one (EnterPlanMode) is dropped', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const plan = cc!.agents.find((a) => a.name === 'plan-agent')
    expect(plan).toBeDefined()
    expect(plan?.tools?.sort()).toEqual(['ask', 'read'])
  })

  it("treats tools: * as undefined and inherits the role's default tool surface", async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const wildcard = cc!.agents.find((a) => a.name === 'wildcard')
    expect(wildcard).toBeDefined()
    expect(wildcard?.tools).toBeUndefined() // * → inherit default (no tool restriction)
  })

  it('parses CC `skills:` frontmatter in agent files into pinnedSkills', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const cc = found.find((p) => p.manifest.name === 'cc-plugin')
    const pinned = cc!.agents.find((a) => a.name === 'pinned')
    expect(pinned).toBeDefined()
    expect(pinned?.pinnedSkills).toEqual(['review', 'security-scan'])
  })

  it('does not discover Claude Code ecosystem plugins from installed_plugins.json', async () => {
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const eco = found.find((p) => p.manifest.name === 'eco-plugin')
    expect(eco).toBeUndefined()
  })
})

describe('foreign skills-dir plugin discovery', () => {
  it('does not discover a plugin embedded in .claude/skills/', async () => {
    // Create a Claude Code plugin manifest under <dir>/.claude/skills/embedded/
    const embeddedDir = join(dir, '.claude', 'skills', 'embedded-plugin')
    await fs.mkdir(join(embeddedDir, CLAUDE_CODE_DIR), { recursive: true })
    await fs.writeFile(
      join(embeddedDir, CLAUDE_CODE_PLUGIN_MANIFEST),
      JSON.stringify({
        name: 'embedded-plugin',
        version: '1.0.0',
        description: 'skills-dir plugin',
      }),
    )
    const found = await discoverPlugins({
      cwd: dir,
      projectId: 'proj1',
      homeDir: home,
    })
    const ep = found.find((p) => p.manifest.name === 'embedded-plugin')
    expect(ep).toBeUndefined()
    await fs.rm(embeddedDir, { recursive: true, force: true })
  })

  it('does not discover plugins from .agents/plugins or .agents/skills', async () => {
    const agentsPlugin = join(dir, '.agents', 'plugins', 'agents-plugin')
    const agentsSkillPlugin = join(dir, '.agents', 'skills', 'agents-skill-plugin')
    for (const [pluginDir, name] of [
      [agentsPlugin, 'agents-plugin'],
      [agentsSkillPlugin, 'agents-skill-plugin'],
    ] as const) {
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name, version: '1.0.0', description: 'must be explicitly imported' }),
      )
    }

    const found = await discoverPlugins({ cwd: dir, projectId: 'proj1', homeDir: home })
    expect(found.find((plugin) => plugin.manifest.name === 'agents-plugin')).toBeUndefined()
    expect(found.find((plugin) => plugin.manifest.name === 'agents-skill-plugin')).toBeUndefined()

    await Promise.all([
      fs.rm(agentsPlugin, { recursive: true, force: true }),
      fs.rm(agentsSkillPlugin, { recursive: true, force: true }),
    ])
  })

  it('does not reinterpret standalone .localix/skills as plugins', async () => {
    const skillDir = join(dir, '.localix', 'skills', 'standalone-only')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      join(skillDir, 'plugin.json'),
      JSON.stringify({
        name: 'standalone-only',
        version: '1.0.0',
        description: 'wrong root for a plugin',
      }),
    )
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: standalone-only\ndescription: standalone skill\n---\n\nDo the thing.',
    )

    const found = await discoverPlugins({ cwd: dir, projectId: 'proj1', homeDir: home })
    expect(found.find((plugin) => plugin.manifest.name === 'standalone-only')).toBeUndefined()

    await fs.rm(skillDir, { recursive: true, force: true })
  })
})

/** Foreign registries, cache layouts, and install paths must remain invisible. */
describe('foreign Claude plugin registries are ignored', () => {
  /** Write a minimal code-free CC plugin at cache/<mp>/<name>/<version>/. */
  const writeCached = async (ccHome: string, mp: string, name: string, version: string) => {
    const cached = join(ccHome, 'cache', mp, name, version)
    await fs.mkdir(join(cached, CLAUDE_CODE_DIR), { recursive: true })
    await fs.writeFile(
      join(cached, CLAUDE_CODE_PLUGIN_MANIFEST),
      JSON.stringify({ name, version, description: `${name} ${version}` }),
    )
    return cached
  }
  /** Keep the Localix home empty so each assertion covers only the planted foreign tree. */
  const discover = (ccHome: string) =>
    discoverPlugins({
      cwd: null,
      projectId: '',
      includeBundled: false,
      homeDir: join(ccHome, 'empty-home'),
    })

  it('does not scan a structural Claude plugin cache', async () => {
    const ccHome = await fs.mkdtemp(join(tmpdir(), 'cc-noreg-'))
    await writeCached(ccHome, 'mp', 'orphan', '1.0.0')
    const found = await discover(ccHome)
    expect(found).toEqual([])
    await fs.rm(ccHome, { recursive: true, force: true })
  })

  it('does not read malformed or valid Claude registries', async () => {
    const ccHome = await fs.mkdtemp(join(tmpdir(), 'cc-badreg-'))
    await writeCached(ccHome, 'mp', 'survivor', '2.0.0')
    await fs.writeFile(join(ccHome, 'installed_plugins.json'), '{ not valid json')
    expect(await discover(ccHome)).toEqual([])
    // A parseable registry whose `plugins` map is missing is equally unusable.
    await fs.writeFile(join(ccHome, 'installed_plugins.json'), JSON.stringify({ version: 99 }))
    expect(await discover(ccHome)).toEqual([])
    await fs.rm(ccHome, { recursive: true, force: true })
  })

  it('does not follow install paths from a Claude registry', async () => {
    const ccHome = await fs.mkdtemp(join(tmpdir(), 'cc-dead-'))
    const goodDir = await writeCached(ccHome, 'mp', 'good', '1.0.0')
    await writeCached(ccHome, 'mp', 'stale', '1.5.0')
    await fs.writeFile(
      join(ccHome, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'good@mp': [{ scope: 'user', installPath: goodDir, version: '1.0.0' }],
          'stale@mp': [
            {
              scope: 'user',
              installPath: join(ccHome, 'gone'),
              version: '1.5.0',
            },
          ],
          'ghost@mp': [{ scope: 'user' }], // no installPath AND no cache dir → dropped alone
        },
      }),
    )
    expect(await discover(ccHome)).toEqual([])
    await fs.rm(ccHome, { recursive: true, force: true })
  })

  it('does not select any cached version', async () => {
    const ccHome = await fs.mkdtemp(join(tmpdir(), 'cc-vers-'))
    await writeCached(ccHome, 'mp', 'multi', '1.9.0')
    await writeCached(ccHome, 'mp', 'multi', '1.10.0')
    // No registry → the numeric-aware latest (1.10.0 > 1.9.0, not lexicographic).
    expect(await discover(ccHome)).toEqual([])
    // Registry references 1.9.0 with a dead installPath → the referenced version wins.
    await fs.writeFile(
      join(ccHome, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'multi@mp': [{ scope: 'user', version: '1.9.0' }] },
      }),
    )
    expect(await discover(ccHome)).toEqual([])
    await fs.rm(ccHome, { recursive: true, force: true })
  })
})

/**
 * BUG B1 REPRO — CC `userConfig`/`config` with `type: "directory"` or `type: "file"`.
 *
 * Before fix: `pluginManifestSchema.safeParse` failed on these types → `plugin.error`
 * set → loader skipped the plugin → tools/MCP/commands silently dropped.
 *
 * After fix (two parts):
 *   Part 1 — `directory`/`file` added to the enum: manifests using these types parse
 *             cleanly with no error. This covers every real CC plugin.
 *   Part 2 — For genuinely unknown types we can't enumerate upfront, graceful recovery
 *             strips the offending config keys and sets a non-fatal warning instead of
 *             a fatal error, so the plugin still loads its tools/MCP/hooks/commands.
 */
describe('B1 — CC directory/file config-option types', () => {
  let b1Dir: string

  beforeAll(async () => {
    b1Dir = await fs.mkdtemp(join(tmpdir(), 'b1-'))

    // Plugin with type:"directory" + type:"file" in userConfig (CC form) + MCP + command.
    // After Part 1 these types are valid — should load with NO error at all.
    const ccDirPlugin = join(b1Dir, '.localix', 'plugins', 'cc-dir-plugin')
    await fs.mkdir(join(ccDirPlugin, 'commands'), { recursive: true })
    await fs.writeFile(
      join(ccDirPlugin, 'plugin.json'),
      JSON.stringify({
        name: 'cc-dir-plugin',
        version: '1.0.0',
        description: 'CC plugin with directory config type',
        // CC form: `userConfig` — automatically promoted to `config` by applyManifestPromotions.
        userConfig: {
          PROJECT_DIR: {
            type: 'directory',
            description: 'Root directory',
            required: false,
          },
          OUTPUT_FILE: {
            type: 'file',
            description: 'Output path',
            required: false,
          },
          API_KEY: { type: 'string', secret: true, description: 'API key' },
        },
        mcpServers: { my_server: { command: 'echo hello' } },
      }),
    )
    await fs.writeFile(
      join(ccDirPlugin, 'commands', 'run.md'),
      '---\ndescription: Run the tool\n---\n\nRun $ARGUMENTS.',
    )

    // Plugin with native `config` using type:"file" + type:"directory".
    // After Part 1 these parse cleanly.
    const fileCfgPlugin = join(b1Dir, '.localix', 'plugins', 'file-cfg-plugin')
    await fs.mkdir(fileCfgPlugin, { recursive: true })
    await fs.writeFile(
      join(fileCfgPlugin, 'plugin.json'),
      JSON.stringify({
        name: 'file-cfg-plugin',
        version: '1.0.0',
        description: 'Plugin with file config type',
        config: {
          CERT_FILE: { type: 'file', description: 'TLS cert path' },
          WORK_DIR: { type: 'directory', description: 'Working directory' },
          VALID_KEY: { type: 'string', description: 'A valid string key' },
        },
        mcpServers: { srv: { command: 'echo ok' } },
      }),
    )

    // Plugin with a TRULY unknown config type (not in our enum) + a valid MCP server.
    // Tests graceful degradation (Part 2): plugin still loads; bad entry stripped; non-fatal warning.
    const unknownTypePlugin = join(b1Dir, '.localix', 'plugins', 'unknown-type-plugin')
    await fs.mkdir(join(unknownTypePlugin, 'commands'), { recursive: true })
    await fs.writeFile(
      join(unknownTypePlugin, 'plugin.json'),
      JSON.stringify({
        name: 'unknown-type-plugin',
        version: '1.0.0',
        description: 'Plugin with unknown config type',
        config: {
          FUTURE_FIELD: {
            type: 'color',
            description: 'Some future config type',
          },
          VALID_TOKEN: { type: 'string', description: 'A valid string key' },
        },
        mcpServers: { fallback_server: { command: 'echo fallback' } },
      }),
    )
    await fs.writeFile(
      join(unknownTypePlugin, 'commands', 'check.md'),
      '---\ndescription: Check things\n---\n\nCheck $ARGUMENTS.',
    )
  })

  afterAll(async () => {
    await fs.rm(b1Dir, { recursive: true, force: true })
  })

  it('B1 Part1: directory/file config types parse cleanly with no error (the primary fix)', async () => {
    const found = await discoverPlugins({
      cwd: b1Dir,
      projectId: 'b1proj',
      homeDir: home,
    })
    const plugin = found.find((p) => p.manifest.name === 'cc-dir-plugin')
    expect(plugin).toBeDefined()
    // After Part 1 these are valid enum values — no error at all.
    expect(plugin!.error).toBeUndefined()
    expect(plugin!.manifestRecovered).toBeUndefined()
    // All three config fields are present.
    expect(plugin!.manifest.config?.['PROJECT_DIR']?.type).toBe('directory')
    expect(plugin!.manifest.config?.['OUTPUT_FILE']?.type).toBe('file')
    expect(plugin!.manifest.config?.['API_KEY']?.type).toBe('string')
    // MCP + command survive (i.e. the plugin was NOT skipped — the pre-fix bug is gone).
    expect(plugin!.provides.mcpServers).toContain('my_server')
    expect(plugin!.provides.commands).toContain('run')
  })

  it('B1 Part1: native config with type:file/directory parses cleanly (no error)', async () => {
    const found = await discoverPlugins({
      cwd: b1Dir,
      projectId: 'b1proj',
      homeDir: home,
    })
    const plugin = found.find((p) => p.manifest.name === 'file-cfg-plugin')
    expect(plugin).toBeDefined()
    expect(plugin!.error).toBeUndefined()
    expect(plugin!.manifestRecovered).toBeUndefined()
    expect(plugin!.manifest.config?.['CERT_FILE']?.type).toBe('file')
    expect(plugin!.manifest.config?.['WORK_DIR']?.type).toBe('directory')
    expect(plugin!.manifest.config?.['VALID_KEY']?.type).toBe('string')
    expect(plugin!.provides.mcpServers).toContain('srv')
  })

  it('B1 Part2: truly unknown config type triggers graceful recovery (non-fatal warning, not skip)', async () => {
    const found = await discoverPlugins({
      cwd: b1Dir,
      projectId: 'b1proj',
      homeDir: home,
    })
    const plugin = found.find((p) => p.manifest.name === 'unknown-type-plugin')
    expect(plugin).toBeDefined()
    // A non-fatal warning is set (not a fatal parse-failure message).
    expect(plugin!.error).toBeTruthy()
    expect(plugin!.error).toContain('partially loaded')
    expect(plugin!.error).toContain('config.FUTURE_FIELD')
    // manifestRecovered is true → loader must NOT skip the plugin.
    expect(plugin!.manifestRecovered).toBe(true)
    // Valid config entry survived; bad one was stripped.
    expect(plugin!.manifest.config?.['VALID_TOKEN']).toBeDefined()
    expect(plugin!.manifest.config?.['FUTURE_FIELD']).toBeUndefined()
    // MCP + command are still present (plugin was NOT skipped).
    expect(plugin!.provides.mcpServers).toContain('fallback_server')
    expect(plugin!.provides.commands).toContain('check')
  })

  it('B1 Part2: a manifest with BOTH an unknown config type AND an invalid name errors fatally', async () => {
    // name: "bad name with spaces" fails PLUGIN_NAME_RE — cannot recover.
    const badDir = join(b1Dir, 'bad-and-config-fail')
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      join(badDir, 'plugin.json'),
      JSON.stringify({
        name: 'bad name with spaces', // invalid
        version: '1.0.0',
        description: 'test',
        config: { X: { type: 'color' } }, // unknown type but irrelevant — name is fatal
      }),
    )
    const plugin = await loadManifest(badDir, 'global', '')
    // Fatal error — no recovery because `name` is outside the config block.
    expect(plugin.error).toBeTruthy()
    expect(plugin.error).not.toContain('partially loaded')
    expect(plugin.manifestRecovered).toBeUndefined()
  })
})

/**
 * BUG B2 REPRO — CC `userConfig` with `sensitive: true` must map to `secret: true`.
 *
 * Before fix: `sensitive` is an unknown field on `pluginConfigOptionSchema`; Zod strips it.
 * The parsed option ends up with `secret: false` (the schema default), so
 * `makePluginSubstituter`'s `isSecret` predicate returns false and the value is
 * substituted into model-facing prompt sections, skill content, and agent prompts.
 *
 * After fix: `applyManifestPromotions` sets `secret: true` on any config option that
 * carries `sensitive: true` before Zod parses the manifest. The parsed option therefore
 * has `secret: true`, and `isSecret(key)` correctly excludes it from substitution.
 */
describe('B2 — CC userConfig sensitive → secret promotion', () => {
  let b2Dir: string

  beforeAll(async () => {
    b2Dir = await fs.mkdtemp(join(tmpdir(), 'b2-'))

    // CC plugin using `userConfig` with `sensitive: true` (the CC form of `secret`).
    const sensitivePlugin = join(b2Dir, '.localix', 'plugins', 'sensitive-plugin')
    await fs.mkdir(sensitivePlugin, { recursive: true })
    await fs.writeFile(
      join(sensitivePlugin, 'plugin.json'),
      JSON.stringify({
        name: 'sensitive-plugin',
        version: '1.0.0',
        description: 'CC plugin with sensitive userConfig',
        userConfig: {
          API_TOKEN: {
            type: 'string',
            sensitive: true,
            description: 'Secret API token',
          },
          PUBLIC_URL: { type: 'string', description: 'Non-sensitive base URL' },
        },
      }),
    )

    // Native `config` with both `secret: true` (native form) and `sensitive: true`
    // (CC alias) — both must resolve to secret: true; native secret must still work.
    const nativeMixPlugin = join(b2Dir, '.localix', 'plugins', 'native-mix')
    await fs.mkdir(nativeMixPlugin, { recursive: true })
    await fs.writeFile(
      join(nativeMixPlugin, 'plugin.json'),
      JSON.stringify({
        name: 'native-mix',
        version: '1.0.0',
        description: 'Native config with both sensitive and secret',
        config: {
          NATIVE_SECRET: {
            type: 'string',
            secret: true,
            description: 'Native secret',
          },
          CC_SENSITIVE: {
            type: 'string',
            sensitive: true,
            description: 'CC-style secret',
          },
          PLAIN: { type: 'string', description: 'Non-sensitive key' },
        },
      }),
    )
  })

  afterAll(async () => {
    await fs.rm(b2Dir, { recursive: true, force: true })
  })

  it('B2: userConfig sensitive:true is promoted to secret:true on the parsed manifest', async () => {
    const found = await discoverPlugins({
      cwd: b2Dir,
      projectId: 'b2proj',
      homeDir: home,
    })
    const plugin = found.find((p) => p.manifest.name === 'sensitive-plugin')
    expect(plugin).toBeDefined()
    expect(plugin!.error).toBeUndefined()
    // The CC `sensitive: true` must survive Zod as `secret: true`.
    expect(plugin!.manifest.config?.['API_TOKEN']?.secret).toBe(true)
    // Non-sensitive key must NOT be flagged as secret.
    expect(plugin!.manifest.config?.['PUBLIC_URL']?.secret).toBe(false)
  })

  it('B2: native config sensitive:true alias also maps to secret:true; native secret unchanged', async () => {
    const found = await discoverPlugins({
      cwd: b2Dir,
      projectId: 'b2proj',
      homeDir: home,
    })
    const plugin = found.find((p) => p.manifest.name === 'native-mix')
    expect(plugin).toBeDefined()
    expect(plugin!.error).toBeUndefined()
    expect(plugin!.manifest.config?.['NATIVE_SECRET']?.secret).toBe(true)
    expect(plugin!.manifest.config?.['CC_SENSITIVE']?.secret).toBe(true)
    expect(plugin!.manifest.config?.['PLAIN']?.secret).toBe(false)
  })
})

describe('resolveEntrypoints', () => {
  it('applies directory defaults (./tools for a mini app, ./skills) when the manifest is silent', async () => {
    const pluginDir = join(dir, '.localix', 'plugins', 'weather')
    const plugin = await loadManifest(pluginDir, 'project', 'proj1')
    const eps = await resolveEntrypoints(
      pluginDir,
      { name: 'weather', version: '0', description: '' },
      'mini-app',
    )
    expect(eps.toolEntries.some((p) => p.endsWith('tools/index.mjs'))).toBe(true)
    expect(eps.skillDirs.some((p) => p.endsWith('/skills'))).toBe(true)
    // The manifest-declared MCP server is resolved through loadManifest.
    expect(Object.keys(plugin.entrypoints.mcpServers)).toContain('wx')
  })
})

describe('persistent plugin scan cache', () => {
  it('shares an in-flight scope scan, then checks again after it settles', async () => {
    const cacheHome = await fs.mkdtemp(join(tmpdir(), 'plugins-scan-concurrent-'))
    const pluginDir = join(cacheHome, '.localix', 'plugins', 'cache-probe')
    await fs.mkdir(pluginDir, { recursive: true })
    await fs.writeFile(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: 'cache-probe', version: '1' }),
    )
    const rename = spyOn(fs, 'rename')
    const cacheFile = join(cacheHome, '.localix', 'cache', 'plugin-scan-cache-v1.json')
    try {
      const concurrent = await Promise.all(
        Array.from({ length: 8 }, () =>
          discoverPlugins({ cwd: null, homeDir: cacheHome, includeBundled: false }),
        ),
      )
      expect(concurrent.every((plugins) => plugins[0]?.manifest.version === '1')).toBe(true)
      expect(rename.mock.calls.filter(([, dest]) => dest === cacheFile)).toHaveLength(1)

      await fs.writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'cache-probe', version: '2', description: 'modified' }),
      )
      const changed = await discoverPlugins({
        cwd: null,
        homeDir: cacheHome,
        includeBundled: false,
      })
      expect(changed[0]?.manifest.version).toBe('2')
      expect(rename.mock.calls.filter(([, dest]) => dest === cacheFile)).toHaveLength(2)
    } finally {
      rename.mockRestore()
      await fs.rm(cacheHome, { recursive: true, force: true })
    }
  })

  it('falls back to a full manifest scan when a cached file fingerprint changes', async () => {
    const cacheHome = await fs.mkdtemp(join(tmpdir(), 'plugins-scan-cache-'))
    const pluginDir = join(cacheHome, '.localix', 'plugins', 'cache-probe')
    const manifestPath = join(pluginDir, 'plugin.json')
    await fs.mkdir(pluginDir, { recursive: true })
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ name: 'cache-probe', version: '1.0.0', description: 'first' }),
    )

    try {
      const first = await discoverPlugins({
        cwd: null,
        homeDir: cacheHome,
        includeBundled: false,
      })
      expect(first.find((plugin) => plugin.manifest.name === 'cache-probe')?.manifest.version).toBe(
        '1.0.0',
      )
      const cacheFile = join(cacheHome, '.localix', 'cache', 'plugin-scan-cache-v1.json')
      expect(
        await fs
          .stat(cacheFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      const cacheWithMarker = {
        ...(JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Record<string, unknown>),
        testMarker: 'cache-hit-preserved',
      }
      await fs.writeFile(cacheFile, JSON.stringify(cacheWithMarker))
      const unchanged = await discoverPlugins({
        cwd: null,
        homeDir: cacheHome,
        includeBundled: false,
      })
      expect(
        unchanged.find((plugin) => plugin.manifest.name === 'cache-probe')?.manifest.version,
      ).toBe('1.0.0')
      expect(
        (JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Record<string, unknown>).testMarker,
      ).toBe('cache-hit-preserved')

      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          name: 'cache-probe',
          version: '2.0.0',
          description: 'second version has a different size',
        }),
      )
      const changed = await discoverPlugins({
        cwd: null,
        homeDir: cacheHome,
        includeBundled: false,
      })
      expect(
        changed.find((plugin) => plugin.manifest.name === 'cache-probe')?.manifest.version,
      ).toBe('2.0.0')
      expect(
        (JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Record<string, unknown>).testMarker,
      ).toBeUndefined()
    } finally {
      await fs.rm(cacheHome, { recursive: true, force: true })
    }
  })
})
