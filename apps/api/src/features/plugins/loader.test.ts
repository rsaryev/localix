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

import { READ_RESULT_TOOLS } from '@localixai/agent'
import { loadEnabledPlugins } from './loader'
import { PLUGIN_TOOL_DESCRIPTION_MAX_CHARS } from './tool-policy'

declare global {
  // eslint-disable-next-line no-var
  var __TEST_LEGACY_CONTRIBUTES_IMPORTS__: number | undefined
}

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
const prevBundled = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-load-'))
  // Isolate the bundled root so the repo's real plugins/ (now default-enabled) don't
  // leak into these tests — point it at an empty dir.
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = await fs.mkdtemp(join(tmpdir(), 'plugin-load-bundled-'))

  // Plugin with native tools (one valid, one reserved-name that must be dropped),
  // a hook, an MCP server with config substitution, and a bundled skill.
  const demo = join(dir, '.localix', 'plugins', 'demo')
  await fs.mkdir(join(demo, 'tools'), { recursive: true })
  await fs.mkdir(join(demo, 'skills', 'greet'), { recursive: true })
  await fs.writeFile(
    join(demo, 'plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      description: 'Demo plugin',
      config: { TOKEN: { type: 'string', secret: true } },
      mcpServers: { api: { command: 'echo run', env: { TOKEN: '${TOKEN}' } } },
    }),
  )
  await fs.writeFile(
    join(demo, 'tools', 'index.mjs'),
    [
      'export const tools = [',
      '  { name: "hello", description: "say hi", inputSchema: {}, execute: async () => ({ content: "hi" }) },',
      '  { name: "bash", description: "reserved", inputSchema: {}, execute: async () => ({ content: "x" }) },',
      '  { name: "Bash", description: "case-variant reserved", inputSchema: {}, execute: async () => ({ content: "x" }) },',
      '  { name: "MixedTool", description: "non-canonical", inputSchema: {}, execute: async () => ({ content: "x" }) },',
      ']',
      'export const hooks = { onSessionStart: () => {} }',
    ].join('\n'),
  )
  await fs.writeFile(
    join(demo, 'skills', 'greet', 'SKILL.md'),
    '---\nname: greet\ndescription: Greet the user\n---\n\nSay hello.',
  )

  // A second plugin that stays disabled — its code must never load.
  const off = join(dir, '.localix', 'plugins', 'off')
  await fs.mkdir(join(off, 'tools'), { recursive: true })
  await fs.writeFile(
    join(off, 'plugin.json'),
    JSON.stringify({ name: 'off', version: '1.0.0', description: 'disabled' }),
  )
  await fs.writeFile(
    join(off, 'tools', 'index.mjs'),
    'export const tools = [{ name: "should_not_load", description: "no", inputSchema: {}, execute: async () => ({ content: "" }) }]',
  )

  // A register(ctx) plugin whose tool echoes ctx.cwd — proves the session cwd is plumbed through.
  const probe = join(dir, '.localix', 'plugins', 'cwd-probe')
  await fs.mkdir(join(probe, 'tools'), { recursive: true })
  await fs.writeFile(
    join(probe, 'plugin.json'),
    JSON.stringify({ name: 'cwd-probe', version: '1.0.0', description: 'echoes cwd' }),
  )
  await fs.writeFile(
    join(probe, 'tools', 'index.mjs'),
    [
      'export function register(ctx) {',
      '  return { tools: [{ name: "where", description: "echo cwd", inputSchema: {}, execute: async () => ({ content: ctx.cwd }) }] }',
      '}',
    ].join('\n'),
  )

  const verbose = join(dir, '.localix', 'plugins', 'verbose-tool')
  await fs.mkdir(join(verbose, 'tools'), { recursive: true })
  await fs.writeFile(
    join(verbose, 'plugin.json'),
    JSON.stringify({
      name: 'verbose-tool',
      version: '1.0.0',
      description: 'oversized tool metadata fixture',
    }),
  )
  await fs.writeFile(
    join(verbose, 'tools', 'index.mjs'),
    `export const tools = [{ name: "verbose_lookup", description: "${'x'.repeat(
      PLUGIN_TOOL_DESCRIPTION_MAX_CHARS + 500,
    )}", inputSchema: {}, execute: async () => ({ content: "ok" }) }]`,
  )

  // A code-free plugin contributing only declarative prompt sections.
  const styler = join(dir, '.localix', 'plugins', 'styler')
  await fs.mkdir(styler, { recursive: true })
  await fs.writeFile(
    join(styler, 'plugin.json'),
    JSON.stringify({
      name: 'styler',
      version: '1.0.0',
      description: 'prompt sections only',
      promptSections: [
        { title: 'House style', content: 'Prefer concise replies.' },
        { title: 'Domain', content: 'This team builds payment systems.' },
      ],
      agents: [
        {
          name: 'doc-writer',
          label: 'Doc Writer',
          description: 'writes docs',
          prompt: 'You write documentation.',
          tools: ['read', 'search', 'write', 'agents'],
        },
        { name: 'auditor', prompt: 'You audit for security issues.' },
      ],
    }),
  )

  // A plugin with inline agents using CC tool names (should be normalized) + pinnedSkills.
  const ccnorm = join(dir, '.localix', 'plugins', 'ccnorm')
  await fs.mkdir(ccnorm, { recursive: true })
  await fs.writeFile(
    join(ccnorm, 'plugin.json'),
    JSON.stringify({
      name: 'ccnorm',
      version: '1.0.0',
      description: 'CC name normalization test',
      agents: [
        {
          name: 'norm-agent',
          prompt: 'You normalize.',
          tools: ['Bash', 'Read', 'Grep'],
          pinnedSkills: ['deploy-guide'],
        },
      ],
    }),
  )

  // A Claude Code-layout plugin shipping a subagent as agents/reviewer.md (no inline
  // `agents` field) — proves CC plugin subagents reach the delegation roster.
  const ccagent = join(dir, '.localix', 'plugins', 'ccagent')
  await fs.mkdir(join(ccagent, 'agents'), { recursive: true })
  await fs.writeFile(
    join(ccagent, 'plugin.json'),
    JSON.stringify({ name: 'ccagent', version: '1.0.0', description: 'CC subagent plugin' }),
  )
  await fs.writeFile(
    join(ccagent, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\n---\n\nYou are a meticulous code reviewer.',
  )

  // A plugin whose tool self-classifies its VBC context class — proves the loader
  // registers it generically (no plugin tool name hardcoded in core).
  const classer = join(dir, '.localix', 'plugins', 'classer')
  await fs.mkdir(join(classer, 'tools'), { recursive: true })
  await fs.writeFile(
    join(classer, 'plugin.json'),
    JSON.stringify({ name: 'classer', version: '1.0.0', description: 'context-class probe' }),
  )
  await fs.writeFile(
    join(classer, 'tools', 'index.mjs'),
    'export const tools = [{ name: "classy_read", description: "x", contextClass: "readResult", inputSchema: {}, execute: async () => ({ content: "" }) }]',
  )

  // Two plugins both declaring a memory provider — only the first enabled wins.
  for (const name of ['mem-a', 'mem-b']) {
    const memDir = join(dir, '.localix', 'plugins', name)
    await fs.mkdir(join(memDir, 'tools'), { recursive: true })
    await fs.writeFile(
      join(memDir, 'plugin.json'),
      JSON.stringify({ name, version: '1.0.0', description: 'memory provider' }),
    )
    await fs.writeFile(
      join(memDir, 'tools', 'index.mjs'),
      [
        'export function register() {',
        `  return { memory: { loadContext: () => ({ context: 'from ${name}' }) } }`,
        '}',
      ].join('\n'),
    )
  }

  // A plugin whose `skills` path points directly at a skill dir (SKILL.md inside) —
  // the Claude Code `skills: ["./path/to/skill"]` form (e.g. ui-ux-pro-max).
  const directSkill = join(dir, '.localix', 'plugins', 'direct-skill')
  await fs.mkdir(join(directSkill, '.claude', 'skills', 'designer'), { recursive: true })
  await fs.writeFile(
    join(directSkill, 'plugin.json'),
    JSON.stringify({
      name: 'direct-skill',
      version: '1.0.0',
      description: 'direct skill path',
      skills: ['./.claude/skills/designer'],
    }),
  )
  await fs.writeFile(
    join(directSkill, '.claude', 'skills', 'designer', 'SKILL.md'),
    '---\nname: designer\ndescription: Design things\n---\n\nDesign beautifully.',
  )

  // B2 — CC plugin using `userConfig` with `sensitive: true`.
  // promptSections and a skill reference both keys; only the non-sensitive one
  // should be substituted into model-facing text.
  const b2Plugin = join(dir, '.localix', 'plugins', 'b2-sensitive')
  await fs.mkdir(join(b2Plugin, 'skills', 'b2skill'), { recursive: true })
  await fs.writeFile(
    join(b2Plugin, 'plugin.json'),
    JSON.stringify({
      name: 'b2-sensitive',
      version: '1.0.0',
      description: 'B2 sensitive leak test',
      userConfig: {
        API_TOKEN: { type: 'string', sensitive: true, description: 'Secret API token' },
        BASE_URL: { type: 'string', description: 'Non-sensitive base URL' },
      },
      promptSections: [{ title: 'Config', content: 'Token=${API_TOKEN} URL=${BASE_URL}' }],
    }),
  )
  await fs.writeFile(
    join(b2Plugin, 'skills', 'b2skill', 'SKILL.md'),
    '---\nname: b2skill\ndescription: B2 skill\n---\n\nCall ${BASE_URL} with auth ${API_TOKEN}.',
  )

  // A plugin still carrying the removed `contributes` declaration. It must load like
  // any other plugin — the field is inert manifest data now, not a second code path.
  const legacy = join(dir, '.localix', 'plugins', 'legacy-contributes')
  await fs.mkdir(join(legacy, 'tools'), { recursive: true })
  await fs.writeFile(
    join(legacy, 'plugin.json'),
    JSON.stringify({
      name: 'legacy-contributes',
      version: '1.0.0',
      description: 'manifest that still declares the removed contributes block',
      tools: './tools/index.mjs',
      contributes: {
        tools: [
          {
            name: 'declared_only',
            description: 'A tool the module does not actually export',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
        hooks: [],
        backends: [],
        channels: [],
        memory: null,
      },
    }),
  )
  await fs.writeFile(
    join(legacy, 'tools', 'index.mjs'),
    [
      'globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__ = (globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__ ?? 0) + 1',
      'const schema = { type: "object", properties: {}, additionalProperties: false }',
      'const inputSchema = { toJSONSchema: () => schema, safeParse: (value) => ({ success: true, data: value }) }',
      'export const tools = [{ name: "really_exported", description: "The tool the module exports", inputSchema, execute: async () => ({ content: "ok" }) }]',
    ].join('\n'),
  )
})

afterAll(async () => {
  if (prevBundled === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevBundled
  delete globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__
  await fs.rm(dir, { recursive: true, force: true })
})

describe('loadEnabledPlugins', () => {
  /**
   * There is ONE loading path. A manifest that still carries the removed `contributes`
   * block gets no special treatment: the module is imported, and the tools are the ones
   * it actually exports — not the ones the block claims. Anything else would leave a
   * manifest able to advertise a tool that does not exist.
   */
  it('ignores a leftover `contributes` block — the module is imported and it decides', async () => {
    globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__ = 0
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('legacy-contributes')]), allowing('legacy-contributes')),
    )

    expect(globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__).toBe(1)
    const names = loaded.tools.map((tool) => tool.name)
    expect(names).toContain('really_exported')
    expect(names).not.toContain('declared_only')
  })

  /**
   * "The plugin load got faster" has to be checkable. `scripts/startup-budget.ts` reads
   * the runtime log, and the runtime log used to say nothing about plugin loading — so
   * every change to this pipeline was argued from first principles instead of a number.
   */
  it('reports what the load cost, once, and only to a logger that takes info', async () => {
    const lines: Array<{ msg: string; meta: unknown }> = []
    await loadEnabledPlugins({
      ...opts(fakeRepo([state('legacy-contributes')]), allowing('legacy-contributes')),
      logger: { warn: () => {}, info: (msg, meta) => lines.push({ msg, meta }) },
    })

    expect(lines).toHaveLength(1)
    const meta = lines[0].meta as {
      event: string
      plugins: number
      nativeMs: number
      totalMs: number
      slowest: Array<{ name: string; ms: number }>
    }
    expect(meta.event).toBe('plugins.loaded')
    expect(meta.plugins).toBe(1)
    expect(meta.slowest[0].name).toBe('legacy-contributes')
    expect(meta.nativeMs).toBeGreaterThanOrEqual(0)
    expect(meta.totalMs).toBeGreaterThanOrEqual(meta.nativeMs)
  })

  it('stays silent for a logger with no info — the per-run load is not a diagnostic', async () => {
    const warnings: string[] = []
    // Guard the guard: a `warn`-only logger is what the per-run load passes, and the
    // summary must not reach it by some other route.
    const loaded = await loadEnabledPlugins({
      ...opts(fakeRepo([state('legacy-contributes')]), allowing('legacy-contributes')),
      logger: { warn: (msg) => warnings.push(msg) },
    })
    expect(loaded.tools.map((tool) => tool.name)).toContain('really_exported')
    expect(warnings.some((line) => line.includes('plugins loaded'))).toBe(false)
  })

  it('loads native tools from an enabled plugin and drops reserved names', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('demo', { TOKEN: 's3cr3t' })]), allowing('demo')),
    )
    const names = loaded.tools.map((t) => t.name)
    expect(names).toContain('hello')
    expect(names).not.toContain('bash') // reserved → dropped
    expect(names).not.toContain('Bash') // case variants cannot form a second identity
    expect(names).not.toContain('MixedTool') // permission/frontmatter names are lowercase
    const summary = loaded.loaded.find((p) => p.name === 'demo')
    expect(summary?.toolNames).toEqual(['hello'])
  })

  it("registers an enabled plugin tool's contextClass into the VBC sets (no core hardcoding)", async () => {
    expect(READ_RESULT_TOOLS.has('classy_read')).toBe(false)
    await loadEnabledPlugins(opts(fakeRepo([state('classer')]), allowing('classer')))
    expect(READ_RESULT_TOOLS.has('classy_read')).toBe(true)
  })

  it('passes the session cwd to register(ctx) via ctx.cwd', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('cwd-probe')]), allowing('cwd-probe')),
    )
    const where = loaded.tools.find((t) => t.name === 'where')
    expect(where).toBeDefined()
    const res = await where!.execute('c', {})
    expect(res.content).toBe(dir) // opts(repo) sets cwd: dir
  })

  it('caps oversized native tool metadata before it reaches the model registry', async () => {
    const warnings: string[] = []
    const loaded = await loadEnabledPlugins({
      ...opts(fakeRepo([state('verbose-tool')]), allowing('verbose-tool')),
      logger: { warn: (message) => warnings.push(message) },
    })
    const tool = loaded.tools.find((candidate) => candidate.name === 'verbose_lookup')

    expect(tool?.description).toHaveLength(PLUGIN_TOOL_DESCRIPTION_MAX_CHARS)
    expect(tool?.description).toEndWith('…')
    expect(warnings.some((warning) => warning.includes('description capped'))).toBe(true)
  })

  it('does not load code for plugins nothing switched on (the trust gate)', async () => {
    globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__ = 0
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('demo'), state('off'), state('legacy-contributes')]), allowing()),
    )
    expect(loaded.tools).toHaveLength(0)
    expect(loaded.loaded).toHaveLength(0)
    expect(globalThis.__TEST_LEGACY_CONTRIBUTES_IMPORTS__).toBe(0)
  })

  it('builds namespaced MCP records with config substitution', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([state('demo', { TOKEN: 's3cr3t' })]), allowing('demo')),
    )
    const server = loaded.mcpServers.find((s) => s.name === 'demo_api')
    expect(server).toBeDefined()
    expect(server!.transport).toBe('stdio')
    expect((server!.config.env as Record<string, string>).TOKEN).toBe('s3cr3t')
  })

  it('folds bundled skills into the skill list and collects hooks', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('demo')]), allowing('demo')))
    expect(loaded.skills.find((s) => s.name === 'greet')).toBeDefined()
    expect(loaded.hooks).toHaveLength(1)
    expect(loaded.hooks[0].pluginName).toBe('demo')
  })
})

describe('promptSections', () => {
  it('collects declarative prompt sections from enabled plugins, attributed by name', async () => {
    const repo = fakeRepo([state('styler')])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('styler')))
    expect(loaded.promptSections).toEqual([
      { pluginName: 'styler', title: 'House style', content: 'Prefer concise replies.' },
      { pluginName: 'styler', title: 'Domain', content: 'This team builds payment systems.' },
    ])
  })

  it('contributes nothing when the plugin is disabled', async () => {
    const repo = fakeRepo([state('styler')])
    const loaded = await loadEnabledPlugins(opts(repo))
    expect(loaded.promptSections).toEqual([])
  })

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
  it('collects manifest agents, namespaced and tool-defaulted, from an enabled plugin', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('styler')]), allowing('styler')))
    expect(loaded.agents).toEqual([
      {
        pluginName: 'styler',
        name: 'doc-writer',
        fullName: 'styler:doc-writer',
        label: 'Doc Writer',
        description: 'writes docs',
        prompt: 'You write documentation.',
        tools: ['read', 'search', 'write', 'agents'],
      },
      {
        pluginName: 'styler',
        name: 'auditor',
        fullName: 'styler:auditor',
        label: 'auditor',
        description: '',
        prompt: 'You audit for security issues.',
      },
    ])
  })

  it('contributes no agents when the rules switched the plugin off', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('styler')]), allowing()))
    expect(loaded.agents).toEqual([])
  })

  it('normalizes CC tool names in inline manifest agents (Bash→bash, Grep→search) + propagates pinnedSkills', async () => {
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
 * this: if `manifest.config[key].secret` is true the value is replaced with `''`.
 *
 * Before the fix: `sensitive: true` was stripped by Zod as an unknown field → the
 * option ended up with `secret: false` → the value was substituted into the prompt.
 *
 * After the fix: `applyManifestPromotions` maps `sensitive → secret` before Zod runs
 * → `isSecret` returns true → the value is NOT substituted (stays `''`).
 */
describe('B2 — sensitive:true userConfig key is NOT substituted into model-facing text', () => {
  it('keeps sensitive CC config values out of prompt sections; substitutes non-sensitive ones', async () => {
    const repo = fakeRepo([
      state('b2-sensitive', {
        API_TOKEN: 'super-secret-token',
        BASE_URL: 'https://api.example.com',
      }),
    ])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('b2-sensitive')))
    const section = loaded.promptSections.find((s) => s.pluginName === 'b2-sensitive')
    expect(section).toBeDefined()
    // The non-sensitive key must be substituted.
    expect(section!.content).toContain('URL=https://api.example.com')
    // The sensitive key must NOT appear — replaced with empty string.
    expect(section!.content).not.toContain('super-secret-token')
    expect(section!.content).toContain('Token=')
  })

  it('keeps sensitive CC config values out of skill content', async () => {
    const repo = fakeRepo([
      state('b2-sensitive', { API_TOKEN: 'my-private-key', BASE_URL: 'https://service.io' }),
    ])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('b2-sensitive')))
    const skill = loaded.skills.find((s) => s.name === 'b2skill')
    expect(skill).toBeDefined()
    // Non-sensitive value substituted.
    expect(skill!.content).toContain('https://service.io')
    // Sensitive value NOT present anywhere in the skill text.
    expect(skill!.content).not.toContain('my-private-key')
  })

  it('MCP config still injects the sensitive value (secrets are allowed there)', async () => {
    // Verify via the demo plugin that has secret:true natively — MCP records get the value.
    const repo = fakeRepo([state('demo', { TOKEN: 'mcp-real-secret' })])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('demo')))
    const server = loaded.mcpServers.find((s) => s.name === 'demo_api')
    expect(server).toBeDefined()
    // MCP env must receive the raw secret (isSecret passes () => false for MCP path).
    expect((server!.config.env as Record<string, string>).TOKEN).toBe('mcp-real-secret')
  })
})

describe('memory providers', () => {
  it('collects the provider from an enabled plugin', async () => {
    const repo = fakeRepo([state('mem-a')])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('mem-a')))
    expect(loaded.memory?.pluginName).toBe('mem-a')
    expect(
      await loaded.memory?.provider.loadContext({
        sessionId: 's',
        projectId: null,
        prompt: '',
        builtinContext: '',
      }),
    ).toEqual({ context: 'from mem-a' })
  })

  it('only the first enabled provider is active; the second is ignored with a warning', async () => {
    const warnings: string[] = []
    const repo = fakeRepo([state('mem-a'), state('mem-b')])
    const loaded = await loadEnabledPlugins({
      ...opts(repo, allowing('mem-a', 'mem-b')),
      logger: { warn: (m) => warnings.push(m) },
    })
    expect(loaded.memory?.pluginName).toBe('mem-a')
    expect(warnings.some((w) => w.includes('memory provider ignored'))).toBe(true)
  })

  it('a provider whose plugin is switched off → memory is null', async () => {
    const repo = fakeRepo([state('mem-a')])
    const loaded = await loadEnabledPlugins(opts(repo, allowing()))
    expect(loaded.memory).toBeNull()
  })
})
