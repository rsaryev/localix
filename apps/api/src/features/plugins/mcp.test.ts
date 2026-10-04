import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { PluginConfigValues } from './config'
import {
  pluginDataDir,
  isPlainObject,
  buildPluginOptionEnv,
  collectMcpConfigTokens,
  buildMcpRecords,
} from './mcp'

const plugin = (
  mcpServers: Record<string, unknown>,
  config: Record<string, unknown> = { API_KEY: { type: 'string' } },
): never =>
  ({
    dir: '/plugins/p',
    projectId: null,
    manifest: { name: 'p', config },
    entrypoints: { mcpServers },
  }) as never

/** A plugin declaring one sensitive key (SECRET) and one plain key (REGION). */
const secretPlugin = (mcpServers: Record<string, unknown>): never =>
  plugin(mcpServers, {
    SECRET: { type: 'string', secret: true },
    REGION: { type: 'string' },
  })

describe('buildMcpRecords', () => {
  test('no servers → no records', () => {
    expect(buildMcpRecords(plugin({}), {}, 'u', 'ts', '/home/u')).toEqual([])
  })

  test('builds a namespaced stdio record, substituting ${CLAUDE_PLUGIN_ROOT}', () => {
    const recs = buildMcpRecords(
      plugin({ srv: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/s.mjs'] } }),
      {},
      'u',
      'ts',
      '/home/u',
    )
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({
      id: 'plugin:p:srv',
      name: 'p_srv',
      transport: 'stdio',
      userId: 'u',
      projectId: null,
      createdAt: 'ts',
      updatedAt: 'ts',
    })
    // the plugin-root token resolved to the plugin dir
    expect(JSON.stringify(recs[0].config)).toContain('/plugins/p/s.mjs')
  })

  test('injects CLAUDE_PLUGIN_OPTION_<KEY> env from the plugin config (stdio)', () => {
    const recs = buildMcpRecords(
      plugin({ srv: { command: 'node' } }),
      { API_KEY: 'sk-1' },
      'u',
      'ts',
      '/home/u',
    )
    expect(
      (recs[0].config as { env?: Record<string, string> }).env?.CLAUDE_PLUGIN_OPTION_API_KEY,
    ).toBe('sk-1')
  })

  test('sensitive key in env IS substituted (env is the sanctioned secret channel)', () => {
    const recs = buildMcpRecords(
      secretPlugin({ srv: { command: 'node', env: { TOKEN: '${user_config.SECRET}' } } }),
      { SECRET: 'sk-live', REGION: 'eu' },
      'u',
      'ts',
      '/home/u',
    )
    expect((recs[0].config as { env?: Record<string, string> }).env?.TOKEN).toBe('sk-live')
  })

  test('sensitive key in command/args/url/headers is NOT substituted and warns', () => {
    const warns: string[] = []
    const recs = buildMcpRecords(
      secretPlugin({
        srv: {
          url: 'https://x.example/${SECRET}',
          headers: { Authorization: 'Bearer ${user_config.SECRET}' },
        },
      }),
      { SECRET: 'sk-live', REGION: 'eu' },
      'u',
      'ts',
      '/home/u',
      { warn: (m) => warns.push(String(m)) },
    )
    const cfg = recs[0].config as { url?: string; headers?: Record<string, string> }
    // Token survives verbatim — the secret value never leaks outside env.
    expect(cfg.url).toBe('https://x.example/${SECRET}')
    expect(cfg.headers?.Authorization).toBe('Bearer ${user_config.SECRET}')
    expect(JSON.stringify(recs[0].config)).not.toContain('sk-live')
    // One warning naming the key and pointing at env.
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('SECRET')
    expect(warns[0]).toContain('"env"')
  })

  test('sensitive key in stdio args is NOT substituted and warns', () => {
    const warns: string[] = []
    const recs = buildMcpRecords(
      secretPlugin({ srv: { command: 'node', args: ['--key=${CLAUDE_PLUGIN_OPTION_SECRET}'] } }),
      { SECRET: 'sk-live' },
      'u',
      'ts',
      '/home/u',
      { warn: (m) => warns.push(String(m)) },
    )
    // normalizeMcpServerEntry flattens command+args into config.command
    expect((recs[0].config as { command?: string[] }).command).toEqual([
      'node',
      '--key=${CLAUDE_PLUGIN_OPTION_SECRET}',
    ])
    expect(warns.some((w) => w.includes('SECRET') && w.includes('"env"'))).toBe(true)
  })

  test('non-sensitive key substitutes everywhere (args, url, headers, env) without warning', () => {
    const warns: string[] = []
    const recs = buildMcpRecords(
      secretPlugin({
        a: { command: 'node', args: ['--region=${REGION}'], env: { R: '${REGION}' } },
        b: { url: 'https://x.example/${REGION}', headers: { 'X-Region': '${user_config.REGION}' } },
      }),
      { REGION: 'eu' },
      'u',
      'ts',
      '/home/u',
      { warn: (m) => warns.push(String(m)) },
    )
    expect((recs[0].config as { command?: string[] }).command).toEqual(['node', '--region=eu'])
    expect((recs[0].config as { env?: Record<string, string> }).env?.R).toBe('eu')
    const b = recs[1].config as { url?: string; headers?: Record<string, string> }
    expect(b.url).toBe('https://x.example/eu')
    expect(b.headers?.['X-Region']).toBe('eu')
    expect(warns).toEqual([])
  })

  test('an invalid server is logged and skipped, not thrown', () => {
    const warns: unknown[] = []
    const recs = buildMcpRecords(
      plugin({ bad: { description: 'no command or url' } }),
      {},
      'u',
      'ts',
      '/home/u',
      { warn: (m) => warns.push(m) },
    )
    expect(recs).toEqual([])
    expect(warns).toHaveLength(1)
  })
})

describe('pluginDataDir', () => {
  test('resolves under ~/.localix/plugin-data and sanitizes the id', () => {
    const home = '/home/u'
    expect(pluginDataDir('my-plugin', home)).toBe(
      join(home, '.localix', 'plugin-data', 'my-plugin'),
    )
    // non-alphanumeric (other than _ and -) → '-'
    expect(pluginDataDir('a@b c.d', home)).toBe(join(home, '.localix', 'plugin-data', 'a-b-c-d'))
    expect(pluginDataDir('keep_under-score', home)).toBe(
      join(home, '.localix', 'plugin-data', 'keep_under-score'),
    )
  })
})

describe('isPlainObject', () => {
  test('true only for non-null, non-array objects', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
  })
  test('false for null, arrays, and primitives', () => {
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject('x')).toBe(false)
    expect(isPlainObject(5)).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
  })
})

describe('buildPluginOptionEnv', () => {
  test('prefixes each key with CLAUDE_PLUGIN_OPTION_, preserving case, stringifying values', () => {
    expect(buildPluginOptionEnv({ API_KEY: 'abc', Port: 8080 })).toEqual({
      CLAUDE_PLUGIN_OPTION_API_KEY: 'abc',
      CLAUDE_PLUGIN_OPTION_Port: '8080',
    })
  })
  test('skips undefined / null but keeps falsy-but-present values', () => {
    // `PluginConfigValues` says a value is string|number|boolean, so this input is
    // unspellable under the type — yet the null-guard in buildPluginOptionEnv is LIVE,
    // not dead: the plugins table's `config` column is parsed JSON that nothing
    // runtime-validates, and `resolvePluginConfig` copies stored entries in verbatim.
    // A stored null therefore does reach here. Reproduce the value the way production
    // gets it — straight off JSON.parse, through the same unchecked widening — rather
    // than pretend the type permits it.
    const fromStoredJson = JSON.parse(
      '{"a":null,"b":null,"c":0,"d":false,"e":""}',
    ) as PluginConfigValues
    expect(buildPluginOptionEnv(fromStoredJson)).toEqual({
      CLAUDE_PLUGIN_OPTION_c: '0',
      CLAUDE_PLUGIN_OPTION_d: 'false',
      CLAUDE_PLUGIN_OPTION_e: '',
    })
  })
})

describe('collectMcpConfigTokens', () => {
  test('collects ${KEY} tokens from nested strings/arrays and normalizes prefixes', () => {
    const tokens = collectMcpConfigTokens({
      srv: {
        command: 'run',
        args: ['--key=${CLAUDE_PLUGIN_OPTION_API_KEY}', '${user_config.region}'],
        env: { TOKEN: '${PLAIN}' },
      },
    })
    // prefixes stripped, casing preserved; plain token kept as-is
    expect([...tokens].sort()).toEqual(['API_KEY', 'PLAIN', 'region'])
  })

  test('returns an empty set when there are no tokens', () => {
    expect(collectMcpConfigTokens({ srv: { command: 'echo', args: ['hi'] } }).size).toBe(0)
  })
})
