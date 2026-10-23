import { describe, it, expect } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pluginManifestSchema, type PluginManifest } from './contracts'
import type { DiscoveredPlugin } from './discovery'
import type { ResolvedEntrypoints } from './discovery-entrypoints'
import { normalizeCcToolName } from './discovery'
import { buildMcpRecords, buildPluginOptionEnv, pluginDataDir } from './mcp'
import { pluginConfigOptionSchema } from './contracts-config'
import { validatePlugin } from './validate'
import { pluginTrustClass } from './enable'
import { trustFallback } from '../ext/trust'
import { copyPluginTree } from './install-helpers'

/**
 * Build a COMPLETE `ResolvedEntrypoints` — a plugin that contributes nothing,
 * plus whatever the caller declares. Every test here varies only `mcpServers`,
 * but discovery resolves seven entrypoint kinds: spelling out the empty five at
 * each call site is how they silently fell behind the type when new kinds landed.
 */
function mkEntrypoints(over: Partial<ResolvedEntrypoints> = {}): ResolvedEntrypoints {
  return {
    skillDirs: [],
    mcpServers: {},
    commandFiles: [],
    agentFiles: [],
    hookConfigs: [],
    lspServers: {},
    monitors: [],
    ...over,
  }
}

/** Build a minimal DiscoveredPlugin around a parsed manifest (defaults applied). */
function mkPlugin(
  manifestInput: Record<string, unknown>,
  over: Partial<DiscoveredPlugin> = {},
): DiscoveredPlugin {
  const manifest = pluginManifestSchema.parse(manifestInput) as PluginManifest
  return {
    manifest,
    dir: '/tmp/plugin',
    scope: 'global',
    projectId: '',
    entrypoints: mkEntrypoints(),
    provides: {
      skills: [],
      mcpServers: [],
      commands: [],
    },
    commands: (manifest.commands ?? []).filter(
      (c): c is Exclude<typeof c, string> => typeof c === 'object',
    ),
    agents: (manifest.agents ?? []).filter(
      (a): a is Exclude<typeof a, string> => typeof a === 'object',
    ),
    ...over,
  }
}

describe('normalizeCcToolName (single source of truth for CC→engine mapping)', () => {
  it('lowercases engine names that pass through unchanged', () => {
    expect(normalizeCcToolName('bash')).toBe('bash')
    expect(normalizeCcToolName('Bash')).toBe('bash')
    expect(normalizeCcToolName('Read')).toBe('read')
  })

  it('maps CC alias names to engine names', () => {
    expect(normalizeCcToolName('Grep')).toBe('search')
    expect(normalizeCcToolName('Glob')).toBe('search')
    expect(normalizeCcToolName('Agent')).toBe('agent')
    expect(normalizeCcToolName('WebFetch')).toBe('research')
    expect(normalizeCcToolName('WebSearch')).toBe('research')
    expect(normalizeCcToolName('AskUserQuestion')).toBe('ask')
  })

  it('strips CC pattern syntax before mapping: Bash(git *) → bash', () => {
    expect(normalizeCcToolName('Bash(git *)')).toBe('bash')
    expect(normalizeCcToolName('Grep(*.ts)')).toBe('search')
  })

  it('returns lowercase input when name is not in the map', () => {
    expect(normalizeCcToolName('UnknownTool')).toBe('unknowntool')
  })
})

describe('validatePlugin — required config and built-in path variables', () => {
  it('flags required config that is unset, and clears once provided', () => {
    const plugin = mkPlugin({
      name: 'a',
      config: { KEY: { type: 'string', required: true } },
    })
    expect(
      validatePlugin(plugin, { config: {} }).warnings.some((w) => /Required config "KEY"/.test(w)),
    ).toBe(true)
    expect(
      validatePlugin(plugin, { config: { KEY: 'set' } }).warnings.some((w) =>
        /Required config "KEY"/.test(w),
      ),
    ).toBe(false)
  })

  it('does NOT warn about built-in path vars (CLAUDE_PLUGIN_ROOT/DATA/PROJECT_DIR) in MCP config', () => {
    const mcpServers = {
      srv: {
        command: '${CLAUDE_PLUGIN_ROOT}/server',
        env: { D: '${CLAUDE_PLUGIN_DATA}', P: '${CLAUDE_PROJECT_DIR}' },
      },
    }
    const plugin = mkPlugin({ name: 'a' }, { entrypoints: mkEntrypoints({ mcpServers }) })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('CLAUDE_PLUGIN_ROOT'))).toBe(false)
    expect(warnings.some((w) => w.includes('CLAUDE_PLUGIN_DATA'))).toBe(false)
    expect(warnings.some((w) => w.includes('CLAUDE_PROJECT_DIR'))).toBe(false)
  })
})

describe('defaultEnabled flag + the trust gate', () => {
  it('NEVER default-enables a plugin, even with defaultEnabled: true', () => {
    const droppedIn = mkPlugin({ name: 'a', defaultEnabled: true })
    expect(pluginTrustClass(droppedIn)).toBe('untrusted')
    expect(trustFallback(pluginTrustClass(droppedIn))).not.toBe('allow')
  })
})

describe('install copy', () => {
  it('copies a plugin tree whole, skipping only version control metadata', async () => {
    const src = await fs.mkdtemp(join(tmpdir(), 'plug-src-'))
    const dest = await fs.mkdtemp(join(tmpdir(), 'plug-dst-'))
    try {
      await fs.mkdir(join(src, '.claude-plugin'), { recursive: true })
      await fs.writeFile(join(src, '.claude-plugin', 'plugin.json'), '{"name":"x"}')
      await fs.mkdir(join(src, '.git'), { recursive: true })
      await fs.writeFile(join(src, '.git', 'config'), 'secret')
      await fs.mkdir(join(src, 'node_modules', 'dep'), { recursive: true })
      await fs.writeFile(join(src, 'node_modules', 'dep', 'i.js'), 'x')
      await fs.mkdir(join(src, 'server', 'dist'), { recursive: true })
      await fs.writeFile(join(src, 'server', 'dist', 'index.js'), '// server')
      await fs.writeFile(join(src, 'server.pyc'), 'bytecode')

      await fs.rm(dest, { recursive: true, force: true }) // cp wants a fresh dest
      await copyPluginTree(src, dest)

      for (const kept of [
        '.claude-plugin/plugin.json',
        'node_modules/dep/i.js',
        'server/dist/index.js',
      ])
        expect(await fs.access(join(dest, kept)).then(() => true)).toBe(true)
      expect(await fs.access(join(dest, 'server.pyc')).then(() => true)).toBe(true)
      expect(
        await fs.access(join(dest, '.git')).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    } finally {
      await fs.rm(src, { recursive: true, force: true })
      await fs.rm(dest, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// C-UC Part A — pluginConfigOptionSchema accepts new CC-spec fields
// ---------------------------------------------------------------------------
describe('C-UC Part A — pluginConfigOptionSchema accepts CC-spec fields (title/multiple/min/max)', () => {
  it('accepts and carries title, multiple, min, max', () => {
    const opt = pluginConfigOptionSchema.parse({
      type: 'number',
      description: 'How many results',
      required: false,
      secret: false,
      title: 'Result limit',
      multiple: false,
      min: 1,
      max: 100,
    })
    expect(opt.title).toBe('Result limit')
    expect(opt.multiple).toBe(false)
    expect(opt.min).toBe(1)
    expect(opt.max).toBe(100)
  })

  it('omits new fields when absent — no spurious defaults', () => {
    const opt = pluginConfigOptionSchema.parse({
      type: 'string',
      description: 'A key',
    })
    expect(opt.title).toBeUndefined()
    expect(opt.multiple).toBeUndefined()
    expect(opt.min).toBeUndefined()
    expect(opt.max).toBeUndefined()
  })

  it('still carries secret and sensitive=true (B1/B2 non-regression)', () => {
    // secret is the host form; Claude Code's sensitive is mapped to it in layout/claude-code.ts
    const opt = pluginConfigOptionSchema.parse({
      type: 'string',
      secret: true,
    })
    expect(opt.secret).toBe(true)
  })

  it('still accepts directory and file types (B1 non-regression)', () => {
    expect(pluginConfigOptionSchema.parse({ type: 'directory' }).type).toBe('directory')
    expect(pluginConfigOptionSchema.parse({ type: 'file' }).type).toBe('file')
  })
})

// ---------------------------------------------------------------------------
// C-UC Part B — CLAUDE_PLUGIN_OPTION_<KEY> env injection into MCP servers
// ---------------------------------------------------------------------------
describe('C-UC Part B — buildPluginOptionEnv emits CLAUDE_PLUGIN_OPTION_<KEY>', () => {
  it('emits one var per config key, case-preserved, value stringified', () => {
    const env = buildPluginOptionEnv({
      API_KEY: 'secret-val',
      MAX_ITEMS: 20,
      ENABLED: true,
    })
    expect(env['CLAUDE_PLUGIN_OPTION_API_KEY']).toBe('secret-val')
    expect(env['CLAUDE_PLUGIN_OPTION_MAX_ITEMS']).toBe('20')
    expect(env['CLAUDE_PLUGIN_OPTION_ENABLED']).toBe('true')
  })

  it('returns empty object when config is empty', () => {
    expect(buildPluginOptionEnv({})).toEqual({})
  })
})

describe('C-UC Part B — buildMcpRecords injects CLAUDE_PLUGIN_OPTION_<KEY> into MCP server env', () => {
  it('injects config values as CLAUDE_PLUGIN_OPTION_<KEY> in the server env block', () => {
    const plugin = mkPlugin(
      {
        name: 'env-test',
        config: {
          API_KEY: { type: 'string', secret: true, required: true },
          MAX_ITEMS: { type: 'number' },
        },
        mcpServers: { srv: { command: 'run-server' } },
      },
      {
        entrypoints: mkEntrypoints({
          mcpServers: { srv: { command: 'run-server' } },
        }),
      },
    )
    const [record] = buildMcpRecords(
      plugin,
      { API_KEY: 'top-secret', MAX_ITEMS: 50 },
      'user-1',
      '2026-01-01T00:00:00.000Z',
      '/home/u',
    )
    const env = record.config.env as Record<string, string> | undefined
    expect(env).toBeDefined()
    expect(env!['CLAUDE_PLUGIN_OPTION_API_KEY']).toBe('top-secret')
    expect(env!['CLAUDE_PLUGIN_OPTION_MAX_ITEMS']).toBe('50')
  })

  it('does NOT overwrite a manifest-declared env var with the injected option var', () => {
    const plugin = mkPlugin(
      {
        name: 'no-clobber',
        config: { API_KEY: { type: 'string', secret: true } },
        mcpServers: {
          srv: {
            command: 'run-server',
            env: { CLAUDE_PLUGIN_OPTION_API_KEY: 'manifest-explicit' },
          },
        },
      },
      {
        entrypoints: mkEntrypoints({
          mcpServers: {
            srv: {
              command: 'run-server',
              env: { CLAUDE_PLUGIN_OPTION_API_KEY: 'manifest-explicit' },
            },
          },
        }),
      },
    )
    const [record] = buildMcpRecords(
      plugin,
      { API_KEY: 'from-config' },
      'user-1',
      '2026-01-01T00:00:00.000Z',
      '/home/u',
    )
    const env = record.config.env as Record<string, string> | undefined
    // The manifest-explicit value wins; the injected config value must not overwrite it.
    expect(env!['CLAUDE_PLUGIN_OPTION_API_KEY']).toBe('manifest-explicit')
  })

  it('exports only the plugin path variables when config is empty and manifest has no env', () => {
    const plugin = mkPlugin(
      {
        name: 'no-config',
        mcpServers: { srv: { command: 'run-server' } },
      },
      {
        entrypoints: mkEntrypoints({
          mcpServers: { srv: { command: 'run-server' } },
        }),
      },
    )
    const [record] = buildMcpRecords(plugin, {}, 'user-1', '2026-01-01T00:00:00.000Z', '/home/u')
    // Claude Code exports CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA to a stdio server's process
    // (plugin manifest reference, "Exported to the process"); no option keys without options.
    expect(record.config.env).toEqual({
      CLAUDE_PLUGIN_ROOT: plugin.dir,
      CLAUDE_PLUGIN_DATA: pluginDataDir('no-config', '/home/u'),
    })
  })

  it('lets a manifest env value override an exported plugin path variable', () => {
    const entry = { command: 'run-server', env: { CLAUDE_PLUGIN_DATA: '/elsewhere' } }
    const plugin = mkPlugin(
      { name: 'own-data', mcpServers: { srv: entry } },
      { entrypoints: mkEntrypoints({ mcpServers: { srv: entry } }) },
    )
    const [record] = buildMcpRecords(plugin, {}, 'user-1', '2026-01-01T00:00:00.000Z', '/home/u')
    expect(record.config.env).toMatchObject({
      CLAUDE_PLUGIN_ROOT: plugin.dir,
      CLAUDE_PLUGIN_DATA: '/elsewhere',
    })
  })
})
