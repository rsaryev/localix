import { describe, it, expect } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pluginManifestSchema, type PluginManifest } from './contracts'
import type { DiscoveredPlugin } from './discovery'
import type { ResolvedEntrypoints } from './discovery-entrypoints'
import { normalizeCcToolName } from './discovery'
import { isAcceptableToolName, isReservedToolName, TOOL_NAME_RE } from './tool-policy'
import { buildMcpRecords, buildPluginOptionEnv, collectMcpConfigTokens, pluginDataDir } from './mcp'
import { miniAppConfigOptionSchema } from './contracts-config'
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
    toolEntries: [],
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
    layout: 'legacy',
    dir: '/tmp/plugin',
    scope: 'global',
    projectId: '',
    entrypoints: mkEntrypoints(),
    provides: {
      hasNativeTools: false,
      tools: [],
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
    bundled: false,
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

describe('tool-policy (reserved names derived from the registry)', () => {
  it('treats every built-in as reserved — including browser (a tool the old hand-list missed)', () => {
    expect(isReservedToolName('browser')).toBe(true)
    expect(isReservedToolName('bash')).toBe(true)
    expect(isAcceptableToolName('browser')).toBe(false)
    expect(isReservedToolName('vault')).toBe(true)
    expect(isAcceptableToolName('vault')).toBe(false)
  })

  it('accepts a well-formed non-reserved name and rejects malformed ones', () => {
    expect(isAcceptableToolName('sample_lookup')).toBe(true)
    expect(isAcceptableToolName('_leading')).toBe(false) // leading underscore
    expect(isAcceptableToolName('has space')).toBe(false)
    expect(TOOL_NAME_RE.test('ok123')).toBe(true)
  })
})

describe('mcp ${KEY} substitution is gated to declared config keys', () => {
  it('collectMcpConfigTokens finds tokens nested in objects/arrays', () => {
    const tokens = collectMcpConfigTokens({
      s: { env: { A: '${ALPHA}' }, args: ['--k', '${BETA}'] },
    })
    expect([...tokens].sort()).toEqual(['ALPHA', 'BETA'])
  })

  it('collectMcpConfigTokens normalizes ${user_config.KEY} to bare KEY', () => {
    const tokens = collectMcpConfigTokens({
      s: { env: { T: '${user_config.token}' } },
    })
    expect([...tokens]).toEqual(['token'])
  })

  it('collectMcpConfigTokens normalizes ${CLAUDE_PLUGIN_OPTION_KEY} to bare key (case-preserved, B3 fix)', () => {
    // B3 fix: the suffix is no longer lowercased. ${CLAUDE_PLUGIN_OPTION_TOKEN} → 'TOKEN'
    // so that config declared as TOKEN (uppercase) is correctly matched during substitution.
    const tokens = collectMcpConfigTokens({
      s: { env: { T: '${CLAUDE_PLUGIN_OPTION_TOKEN}' } },
    })
    expect([...tokens]).toEqual(['TOKEN'])
  })

  it('reads host env ONLY for a declared key; an undeclared ${KEY} resolves to empty', () => {
    process.env.PLUGIN_DECLARED = 'from-host-env'
    process.env.PLUGIN_UNDECLARED = 'LEAKED_SECRET'
    try {
      const plugin = mkPlugin(
        {
          name: 'mcp-plug',
          config: { PLUGIN_DECLARED: { type: 'string', secret: true } },
          mcpServers: {
            srv: {
              command: 'run-it',
              env: { D: '${PLUGIN_DECLARED}', U: '${PLUGIN_UNDECLARED}' },
            },
          },
        },
        {
          entrypoints: mkEntrypoints({
            mcpServers: {
              srv: {
                command: 'run-it',
                env: { D: '${PLUGIN_DECLARED}', U: '${PLUGIN_UNDECLARED}' },
              },
            },
          }),
        },
      )
      const [record] = buildMcpRecords(plugin, {}, 'user-1', '2026-01-01T00:00:00.000Z', '/home/u')
      const dump = JSON.stringify(record)
      expect(dump).toContain('from-host-env') // declared key pulled from env
      expect(dump).not.toContain('LEAKED_SECRET') // undeclared key blanked, never read
    } finally {
      delete process.env.PLUGIN_DECLARED
      delete process.env.PLUGIN_UNDECLARED
    }
  })
})

describe('validatePlugin — apiVersion / required-config / undeclared tokens', () => {
  it('warns when apiVersion is absent and errors when it exceeds the host', () => {
    expect(
      validatePlugin(mkPlugin({ name: 'a' })).warnings.some((w) => /no apiVersion/.test(w)),
    ).toBe(true)
    expect(
      validatePlugin(mkPlugin({ name: 'a', apiVersion: 1 })).warnings.some((w) =>
        /apiVersion/.test(w),
      ),
    ).toBe(false)
    expect(
      validatePlugin(mkPlugin({ name: 'a', apiVersion: 999 })).errors.some((e) =>
        /API v999/.test(e),
      ),
    ).toBe(true)
  })

  it('flags required config that is unset, and clears once provided', () => {
    const plugin = mkPlugin({
      name: 'a',
      apiVersion: 1,
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

  it('warns about an MCP ${KEY} that no config option declares', () => {
    const mcpServers = { srv: { command: 'x', env: { T: '${MISSING}' } } }
    const undeclared = mkPlugin(
      { name: 'a', apiVersion: 1 },
      { entrypoints: mkEntrypoints({ mcpServers }) },
    )
    expect(validatePlugin(undeclared).warnings.some((w) => /\$\{MISSING\}/.test(w))).toBe(true)

    const declared = mkPlugin(
      { name: 'a', apiVersion: 1, config: { MISSING: { type: 'string' } } },
      { entrypoints: mkEntrypoints({ mcpServers }) },
    )
    expect(validatePlugin(declared).warnings.some((w) => /\$\{MISSING\}/.test(w))).toBe(false)
  })

  it('does NOT warn about built-in path vars (CLAUDE_PLUGIN_ROOT/DATA/PROJECT_DIR) in MCP config', () => {
    const mcpServers = {
      srv: {
        command: '${CLAUDE_PLUGIN_ROOT}/server',
        env: { D: '${CLAUDE_PLUGIN_DATA}', P: '${CLAUDE_PROJECT_DIR}' },
      },
    }
    const plugin = mkPlugin(
      { name: 'a', apiVersion: 1 },
      { entrypoints: mkEntrypoints({ mcpServers }) },
    )
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('CLAUDE_PLUGIN_ROOT'))).toBe(false)
    expect(warnings.some((w) => w.includes('CLAUDE_PLUGIN_DATA'))).toBe(false)
    expect(warnings.some((w) => w.includes('CLAUDE_PROJECT_DIR'))).toBe(false)
  })
})

describe('defaultEnabled flag + the trust gate', () => {
  const native = {
    hasNativeTools: true,
    tools: [],
    skills: [],
    mcpServers: [],
    commands: [],
  }

  /** What the artifact's class means before any rule is written. */
  const defaultsOn = (plugin: DiscoveredPlugin) =>
    trustFallback(pluginTrustClass(plugin)) === 'allow'

  it('honors the manifest flag for BUNDLED plugins (both directions)', () => {
    // command-only bundled runs; the flag can turn it off
    expect(defaultsOn(mkPlugin({ name: 'a' }, { bundled: true }))).toBe(true)
    expect(defaultsOn(mkPlugin({ name: 'a', defaultEnabled: false }, { bundled: true }))).toBe(
      false,
    )
    // native bundled asks first; an explicit flag can turn it on (it's shipped = trusted)
    expect(defaultsOn(mkPlugin({ name: 'a' }, { bundled: true, provides: native }))).toBe(false)
    expect(
      defaultsOn(
        mkPlugin({ name: 'a', defaultEnabled: true }, { bundled: true, provides: native }),
      ),
    ).toBe(true)
  })

  it('NEVER default-enables a non-bundled plugin, even with defaultEnabled: true', () => {
    const droppedIn = mkPlugin({ name: 'a', defaultEnabled: true }, { bundled: false })
    expect(pluginTrustClass(droppedIn)).toBe('untrusted')
    expect(defaultsOn(droppedIn)).toBe(false)
    expect(
      validatePlugin(
        mkPlugin({ name: 'a', apiVersion: 1, defaultEnabled: true }, { bundled: false }),
      ).warnings.some((w) => /defaultEnabled.*ignored/.test(w)),
    ).toBe(true)
  })

  it('a rule always wins over what the class alone would say', () => {
    // The class answers for an artifact NOBODY has ruled on, and it travels into the rule
    // lookup as the resource — so a rule about the plugin, or about its whole class, decides
    // instead. That composition lives in `ext/catalog.ts`; here only the classes.
    expect(pluginTrustClass(mkPlugin({ name: 'a' }, { bundled: true }))).toBe('bundled')
    expect(
      pluginTrustClass(mkPlugin({ name: 'a', defaultEnabled: false }, { bundled: true })),
    ).toBe('opt-in')
    expect(pluginTrustClass(mkPlugin({ name: 'a' }, { bundled: false }))).toBe('untrusted')
  })
})

describe('install copy', () => {
  it('copies a plugin tree whole, skipping only version control metadata', async () => {
    const src = await fs.mkdtemp(join(tmpdir(), 'plug-src-'))
    const dest = await fs.mkdtemp(join(tmpdir(), 'plug-dst-'))
    try {
      await fs.writeFile(join(src, 'plugin.json'), '{"name":"x"}')
      await fs.mkdir(join(src, '.git'), { recursive: true })
      await fs.writeFile(join(src, '.git', 'config'), 'secret')
      await fs.mkdir(join(src, 'node_modules', 'dep'), { recursive: true })
      await fs.writeFile(join(src, 'node_modules', 'dep', 'i.js'), 'x')
      await fs.mkdir(join(src, 'server', 'dist'), { recursive: true })
      await fs.writeFile(join(src, 'server', 'dist', 'index.js'), '// server')
      await fs.writeFile(join(src, 'server.pyc'), 'bytecode')

      await fs.rm(dest, { recursive: true, force: true }) // cp wants a fresh dest
      await copyPluginTree(src, dest)

      for (const kept of ['plugin.json', 'node_modules/dep/i.js', 'server/dist/index.js'])
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
// C-UC Part A — miniAppConfigOptionSchema accepts new CC-spec fields
// ---------------------------------------------------------------------------
describe('C-UC Part A — miniAppConfigOptionSchema accepts CC-spec fields (title/multiple/min/max)', () => {
  it('accepts and carries title, multiple, min, max', () => {
    const opt = miniAppConfigOptionSchema.parse({
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
    const opt = miniAppConfigOptionSchema.parse({
      type: 'string',
      description: 'A key',
    })
    expect(opt.title).toBeUndefined()
    expect(opt.multiple).toBeUndefined()
    expect(opt.min).toBeUndefined()
    expect(opt.max).toBeUndefined()
  })

  it('still carries secret and sensitive=true (B1/B2 non-regression)', () => {
    // secret is the native form; sensitive is accepted via applyManifestPromotions
    const opt = miniAppConfigOptionSchema.parse({
      type: 'string',
      secret: true,
    })
    expect(opt.secret).toBe(true)
  })

  it('still accepts directory and file types (B1 non-regression)', () => {
    expect(miniAppConfigOptionSchema.parse({ type: 'directory' }).type).toBe('directory')
    expect(miniAppConfigOptionSchema.parse({ type: 'file' }).type).toBe('file')
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
