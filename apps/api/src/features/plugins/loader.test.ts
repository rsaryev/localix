import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED, type AvailabilityReader } from '../capabilities/availability'
import { trustFallback } from '../ext/trust'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

import { loadEnabledPlugins } from './loader'

/** In-memory repo: maps `${projectId}:${name}` → state. */
function fakeRepo(rows: CapabilitySourceRecord[]): CapabilitySourceRepository {
  const byKey = new Map(rows.map((r) => [`${r.projectId}:${r.name}`, r]))
  return {
    listForScope: async (_userId, projectId) =>
      [...byKey.values()].filter((r) => r.projectId === '' || r.projectId === projectId),
    get: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`) ?? null,
    upsert: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`)!,
    patchConfig: async (_u, projectId, name, patch) => {
      const key = `${projectId}:${name}`
      const current = byKey.get(key)!
      const next = { ...current, config: { ...current.config, ...patch } }
      byKey.set(key, next)
      return next
    },
    remove: async () => {},
  }
}

function state(
  name: string,
  config: Record<string, string | number | boolean> = {},
): CapabilitySourceRecord {
  return {
    id: name,
    userId: 'u1',
    projectId: '',
    name,
    config,
    source: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/**
 * A rule store that names exactly which plugins are on.
 *
 * A state row no longer carries an enable bit — availability is a rule composed across
 * global / project / agent — so a test that wants a plugin loaded says so HERE. Anything
 * unnamed is left to the trust gate, which is what an untouched installation does.
 */
const allowing = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name, trust = 'bundled') =>
    names.includes(name) ? 'allow' : trustFallback(trust),
})

let dir: string
const NOW = () => '2026-01-01T00:00:00.000Z'
const opts = (repo: CapabilitySourceRepository, availability: AvailabilityReader = UNDECIDED) => ({
  repo,
  availability,
  userId: 'u1',
  projectId: '',
  cwd: dir,
  homeDir: dir,
  now: NOW,
})

/** Write a plugin's `.claude-plugin/plugin.json`. */
async function writeManifest(pluginDir: string, manifest: Record<string, unknown>) {
  await fs.mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-load-'))

  // A plugin with an MCP server with config substitution and a bundled skill.
  const demo = join(dir, '.localix', 'plugins', 'demo')
  await fs.mkdir(join(demo, 'skills', 'greet'), { recursive: true })
  await writeManifest(demo, {
    name: 'demo',
    version: '1.0.0',
    description: 'Demo plugin',
    userConfig: {
      TOKEN: { type: 'string', title: 'Token', description: 'API token', sensitive: true },
    },
    mcpServers: { api: { command: 'echo run', env: { TOKEN: '${TOKEN}' } } },
  })
  await fs.writeFile(
    join(demo, 'skills', 'greet', 'SKILL.md'),
    '---\nname: greet\ndescription: Greet the user\n---\n\nSay hello.',
  )

  // A plugin contributing worker roles, as Claude Code agent files.
  const styler = join(dir, '.localix', 'plugins', 'styler')
  await fs.mkdir(join(styler, 'agents'), { recursive: true })
  await writeManifest(styler, { name: 'styler', version: '1.0.0', description: 'worker roles' })
  await fs.writeFile(
    join(styler, 'agents', 'doc-writer.md'),
    '---\nname: doc-writer\ndescription: writes docs\ntools: Read, Grep, Write\n---\n\nYou write documentation.',
  )
  await fs.writeFile(
    join(styler, 'agents', 'auditor.md'),
    '---\nname: auditor\ndescription: audits\n---\n\nYou audit for security issues.',
  )

  // An agent using CC tool names (normalized) + `skills:` (pinned skills).
  const ccnorm = join(dir, '.localix', 'plugins', 'ccnorm')
  await fs.mkdir(join(ccnorm, 'agents'), { recursive: true })
  await writeManifest(ccnorm, {
    name: 'ccnorm',
    version: '1.0.0',
    description: 'CC name normalization test',
  })
  await fs.writeFile(
    join(ccnorm, 'agents', 'norm-agent.md'),
    '---\nname: norm-agent\ndescription: normalizes\ntools: Bash, Read, Grep\nskills: deploy-guide\n---\n\nYou normalize.',
  )

  // A Claude Code-layout plugin shipping a subagent as agents/reviewer.md (no inline
  // `agents` field) — proves CC plugin subagents reach the delegation roster.
  const ccagent = join(dir, '.localix', 'plugins', 'ccagent')
  await fs.mkdir(join(ccagent, 'agents'), { recursive: true })
  await writeManifest(ccagent, {
    name: 'ccagent',
    version: '1.0.0',
    description: 'CC subagent plugin',
  })
  await fs.writeFile(
    join(ccagent, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\n---\n\nYou are a meticulous code reviewer.',
  )

  // A plugin whose `skills` path points directly at a skill dir (SKILL.md inside) —
  // the Claude Code `skills: ["./path/to/skill"]` form (e.g. ui-ux-pro-max).
  const directSkill = join(dir, '.localix', 'plugins', 'direct-skill')
  await fs.mkdir(join(directSkill, '.claude', 'skills', 'designer'), { recursive: true })
  await writeManifest(directSkill, {
    name: 'direct-skill',
    version: '1.0.0',
    description: 'direct skill path',
    skills: ['./.claude/skills/designer'],
  })
  await fs.writeFile(
    join(directSkill, '.claude', 'skills', 'designer', 'SKILL.md'),
    '---\nname: designer\ndescription: Design things\n---\n\nDesign beautifully.',
  )

  // B2 — CC plugin using `userConfig` with `sensitive: true`.
  // A skill references both keys; only the non-sensitive one is substituted into model-facing
  // text.
  const b2Plugin = join(dir, '.localix', 'plugins', 'b2-sensitive')
  await fs.mkdir(join(b2Plugin, 'skills', 'b2skill'), { recursive: true })
  await writeManifest(b2Plugin, {
    name: 'b2-sensitive',
    version: '1.0.0',
    description: 'B2 sensitive leak test',
    userConfig: {
      API_TOKEN: {
        type: 'string',
        title: 'API token',
        sensitive: true,
        description: 'Secret API token',
      },
      BASE_URL: { type: 'string', title: 'Base URL', description: 'Non-sensitive base URL' },
    },
  })
  await fs.writeFile(
    join(b2Plugin, 'skills', 'b2skill', 'SKILL.md'),
    '---\nname: b2skill\ndescription: B2 skill\n---\n\nCall ${user_config.BASE_URL} with auth ${user_config.API_TOKEN}.',
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('loadEnabledPlugins', () => {
  it('builds namespaced MCP records with config substitution', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('demo', { TOKEN: 's3cr3t' })]), allowing('demo')),
    )
    const server = loaded.mcpServers.find((s) => s.name === 'demo_api')
    expect(server).toBeDefined()
    expect(server!.transport).toBe('stdio')
    expect((server!.config.env as Record<string, string>).TOKEN).toBe('s3cr3t')
  })

  it('folds bundled skills into the skill list', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('demo')]), allowing('demo')))
    expect(loaded.skills.find((s) => s.name === 'greet')).toBeDefined()
  })

  it('a plugin nothing switched on contributes nothing (the trust gate)', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('demo')]), allowing()))
    expect(loaded.skills).toHaveLength(0)
    expect(loaded.mcpServers).toHaveLength(0)
    expect(loaded.loaded).toHaveLength(0)
  })
})

describe('skills paths', () => {
  it('loads a skill from a manifest skills path that points directly at a skill dir', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('direct-skill')]), allowing('direct-skill')),
    )
    const skill = loaded.skills.find((s) => s.name === 'designer')
    expect(skill).toBeDefined()
    expect(typeof Object.getOwnPropertyDescriptor(skill!, 'content')?.get).toBe('function')
    expect(skill!.content).toContain('Design beautifully.')
  })
})

describe('custom worker roles (plugin agents)', () => {
  it('collects agent files, namespaced and tool-mapped, from an enabled plugin', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('styler')]), allowing('styler')))
    // Agent files load in name order; the label is the name, as Claude Code has none.
    expect(loaded.agents).toEqual([
      {
        pluginName: 'styler',
        name: 'auditor',
        fullName: 'styler:auditor',
        label: 'auditor',
        description: 'audits',
        prompt: 'You audit for security issues.',
      },
      {
        pluginName: 'styler',
        name: 'doc-writer',
        fullName: 'styler:doc-writer',
        label: 'doc-writer',
        description: 'writes docs',
        prompt: 'You write documentation.',
        tools: ['read', 'search', 'write'],
      },
    ])
  })

  it('contributes no agents when the rules switched the plugin off', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('styler')]), allowing()))
    expect(loaded.agents).toEqual([])
  })

  it('normalizes CC tool names in agent files (Bash→bash, Grep→search) + propagates pinnedSkills', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('ccnorm')]), allowing('ccnorm')))
    const agent = loaded.agents.find((a) => a.name === 'norm-agent')
    expect(agent).toBeDefined()
    // CC names normalized to engine names
    expect(agent!.tools?.sort()).toEqual(['bash', 'read', 'search'])
    // pinnedSkills propagated
    expect(agent!.pinnedSkills).toEqual(['deploy-guide'])
  })

  it('surfaces a Claude Code agents/*.md subagent in the delegation roster, dispatchable as a role', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('ccagent')]), allowing('ccagent')))
    const agent = loaded.agents.find((a) => a.fullName === 'ccagent:reviewer')
    expect(agent).toBeDefined()
    expect(agent!.description).toBe('Reviews code')
    expect(agent!.prompt).toContain('meticulous code reviewer')
  })
})

/**
 * BUG B2 — CC `userConfig` `sensitive: true` must NOT leak into model-facing text.
 *
 * The substituter (`makePluginSubstituter`) replaces `${KEY}` tokens with config values
 * in promptSections, skill content, and agent prompts. Its `isSecret` predicate guards
 * this: if `manifest.config[key].secret` is true the token becomes a placeholder naming the option.
 *
 * `sensitive: true` is read as `secret: true` (`layout/claude-code.ts`) → `isSecret` returns
 * true → the value is NOT substituted (a placeholder instead).
 */
describe('B2 — sensitive:true userConfig key is NOT substituted into model-facing text', () => {
  it('keeps sensitive CC config values out of skill content', async () => {
    const repo = fakeRepo([
      state('b2-sensitive', { API_TOKEN: 'my-private-key', BASE_URL: 'https://service.io' }),
    ])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('b2-sensitive')))
    const skill = loaded.skills.find((s) => s.name === 'b2skill')
    expect(skill).toBeDefined()
    // Non-sensitive value substituted.
    expect(skill!.content).toContain('https://service.io')
    // Sensitive value NOT present anywhere in the skill text; a placeholder stands in.
    expect(skill!.content).not.toContain('my-private-key')
    expect(skill!.content).toContain("auth [sensitive option 'API_TOKEN' not available")
  })

  it('MCP config still injects the sensitive value (secrets are allowed there)', async () => {
    // The demo plugin's TOKEN is sensitive — MCP records still get the value.
    const repo = fakeRepo([state('demo', { TOKEN: 'mcp-real-secret' })])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('demo')))
    const server = loaded.mcpServers.find((s) => s.name === 'demo_api')
    expect(server).toBeDefined()
    // MCP env must receive the raw secret (isSecret passes () => false for MCP path).
    expect((server!.config.env as Record<string, string>).TOKEN).toBe('mcp-real-secret')
  })
})
