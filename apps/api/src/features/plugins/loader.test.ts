import { diskPluginHost } from './kit/testing'
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
  pluginHost: diskPluginHost(dir),
  // No managed settings: the machine's own are not the test's.
  managed: null,
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
    // Claude Code's spelling of an option: a bare `${TOKEN}` is an environment variable.
    mcpServers: { api: { command: 'echo run', env: { TOKEN: '${user_config.TOKEN}' } } },
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
  // Two plugins with a bundled CLI whose dependency is not met: one names a plugin nobody
  // installed, the other `styler`, installed but not switched on.
  for (const [name, dependency] of [
    ['needs-missing', 'absent'],
    ['needs-off', 'styler'],
  ] as const) {
    const root = join(dir, '.localix', 'plugins', name)
    await fs.mkdir(join(root, 'bin'), { recursive: true })
    await fs.writeFile(join(root, 'bin', 'tool'), '#!/bin/sh\n')
    await writeManifest(root, { name, version: '1.0.0', dependencies: [dependency] })
  }
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

  it('a plugin nothing switched on contributes nothing (the trust gate)', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([state('demo')]), allowing()))
    expect(loaded.mcpServers).toHaveLength(0)
    expect(loaded.loaded).toHaveLength(0)
  })

  it("hands the plugin host every plugin of the scope, selected as the agent's rules say", async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([]), allowing('demo')))
    const selection = Object.fromEntries(loaded.kitPlugins.map((one) => [one.id, one.selected]))
    expect(selection).toMatchObject({ demo: true, styler: false })
    expect(loaded.kitPlugins.find((one) => one.id === 'demo')?.root).toBe(
      join(dir, '.localix', 'plugins', 'demo'),
    )
  })
})

describe('a plugin whose dependency is not met', () => {
  // As in Claude Code (plugins/troubleshooting.md, "Dependency errors"): the plugin stays off and
  // its row says why, in the kit's words.
  it('does not start, and its row shows the missing or disabled dependency', async () => {
    const loaded = await loadEnabledPlugins(
      opts(fakeRepo([]), allowing('needs-missing', 'needs-off')),
    )
    expect(loaded.binDirs.filter((bin) => bin.includes('needs-'))).toEqual([])
    const rows = Object.fromEntries(loaded.loaded.map((one) => [one.name, one]))
    expect(rows['needs-missing']).toMatchObject({ error: 'Dependency "absent" is not installed' })
    expect(rows['needs-missing']?.binDir).toBeUndefined()
    expect(rows['needs-off']).toMatchObject({
      error: 'Dependency "styler" is disabled — enable it or remove the dependency',
    })
    expect(rows['needs-off']?.binDir).toBeUndefined()
  })

  it('starts once the dependency is switched on', async () => {
    const loaded = await loadEnabledPlugins(opts(fakeRepo([]), allowing('needs-off', 'styler')))
    const row = loaded.loaded.find((one) => one.name === 'needs-off')
    expect(row?.error).toBeUndefined()
    expect(row?.binDir).toBe(join(dir, '.localix', 'plugins', 'needs-off', 'bin'))
  })
})

/**
 * BUG B2 — CC `userConfig` `sensitive: true`: model-facing text gets a placeholder (the kit's
 * `substituteContent`), while an MCP server's config gets the value.
 */
describe('B2 — sensitive:true userConfig key is NOT substituted into model-facing text', () => {
  it('MCP config still injects the sensitive value (secrets are allowed there)', async () => {
    // The demo plugin's TOKEN is sensitive — MCP records still get the value.
    const repo = fakeRepo([state('demo', { TOKEN: 'mcp-real-secret' })])
    const loaded = await loadEnabledPlugins(opts(repo, allowing('demo')))
    const server = loaded.mcpServers.find((s) => s.name === 'demo_api')
    expect(server).toBeDefined()
    // MCP env must receive the raw secret.
    expect((server!.config.env as Record<string, string>).TOKEN).toBe('mcp-real-secret')
  })
})
