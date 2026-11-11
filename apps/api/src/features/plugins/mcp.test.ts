import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { connectServerConfig } from './kit/settings/mcp-connect'
import { loadManifest } from './manifest-load'
import { pluginDataDir } from './mcp'
import { pluginMcpRecords } from './testing/test-mcp-records'

const dir = tempDirPerTest('plugin-mcp-')

/** A plugin `p` with these servers, its options SECRET (sensitive) and REGION. */
async function plugin(mcpServers: Record<string, unknown>) {
  const root = join(dir(), 'plugins', 'p')
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'p',
      userConfig: {
        SECRET: { type: 'string', title: 'Secret', description: 'A key', sensitive: true },
        REGION: { type: 'string', title: 'Region', description: 'Where' },
      },
    }),
    '.mcp.json': JSON.stringify({ mcpServers }),
  })
  return loadManifest(root, 'global', '')
}

const records = async (
  mcpServers: Record<string, unknown>,
  values: Record<string, unknown> = {},
  warns: unknown[] = [],
) =>
  pluginMcpRecords(await plugin(mcpServers), values, dir(), {
    warn: (message, meta) => warns.push(meta === undefined ? message : [message, meta]),
  })

describe("a plugin's MCP server records", () => {
  test('no servers, no records', async () => {
    expect(await records({})).toEqual([])
  })

  test('a namespaced stdio record, `${CLAUDE_PLUGIN_ROOT}` substituted', async () => {
    const [record, ...rest] = await records({
      srv: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/s.mjs'] },
    })
    expect(rest).toEqual([])
    expect(record).toMatchObject({
      id: 'plugin:p:srv',
      name: 'p_srv',
      transport: 'stdio',
      userId: 'u',
      projectId: '',
      createdAt: 'ts',
      updatedAt: 'ts',
      configExpanded: true,
    })
    expect(JSON.stringify(record!.config)).toContain(join(dir(), 'plugins/p/s.mjs'))
  })

  test('a stdio process gets the path variables beneath its own env', async () => {
    const [record] = await records({
      srv: { command: 'node', env: { CLAUDE_PLUGIN_ROOT: 'mine' } },
    })
    const env = (record!.config as { env: Record<string, string> }).env
    expect(env.CLAUDE_PLUGIN_ROOT).toBe('mine')
    expect(env.CLAUDE_PLUGIN_DATA).toBeString()
  })

  // Claude Code substitutes a sensitive option anywhere in an MCP server's config: none of these
  // strings reaches a shell.
  test('a sensitive option substitutes in env, args, url and headers', async () => {
    const warns: unknown[] = []
    const [local, remote] = await records(
      {
        a: {
          command: 'node',
          args: ['${user_config.SECRET}'],
          env: { TOKEN: '${user_config.SECRET}' },
        },
        b: {
          type: 'http',
          url: 'https://x.example/${user_config.REGION}',
          headers: { Authorization: 'Bearer ${user_config.SECRET}' },
        },
      },
      { SECRET: 'sk-live', REGION: 'eu' },
      warns,
    )
    expect((local!.config as { command: string[] }).command).toEqual(['node', 'sk-live'])
    expect((local!.config as { env: Record<string, string> }).env.TOKEN).toBe('sk-live')
    const cfg = remote!.config as { url: string; headers: Record<string, string> }
    expect([cfg.url, cfg.headers.Authorization]).toEqual(['https://x.example/eu', 'Bearer sk-live'])
    expect(warns).toEqual([])
  })

  // An option VALUE is data: a value set to `${GITHUB_TOKEN}` must not read the host credential
  // into the plugin's remote headers when the server connects.
  test('a substituted value is not expanded again when the server connects', async () => {
    const [record] = await records(
      {
        srv: {
          type: 'http',
          url: 'https://x.example/${user_config.REGION}',
          headers: { 'X-Key': '${user_config.SECRET}' },
        },
      },
      { SECRET: '${GITHUB_TOKEN}', REGION: '${HOME}' },
    )
    const connect = connectServerConfig(record!, {
      GITHUB_TOKEN: 'ghp_HOSTSECRET',
      HOME: '/Users/someone',
    })
    expect(JSON.stringify(connect)).not.toContain('ghp_HOSTSECRET')
    expect((connect.headers as Record<string, string>)['X-Key']).toBe('${GITHUB_TOKEN}')
    expect(connect.url).toBe('https://x.example/${HOME}')
  })

  test('a server with neither a command nor a url is left out, the others kept', async () => {
    const found = await records({
      bad: { description: 'no command or url' },
      ok: { command: 'node' },
    })
    expect(found.map(({ name }) => name)).toEqual(['p_ok'])
  })

  test('a server whose variable has no value does not start, and says so', async () => {
    const warns: unknown[] = []
    const found = await records(
      {
        gone: { command: 'node', args: ['${LOCALIX_TEST_UNSET_VARIABLE}'] },
        ok: { command: 'node' },
      },
      {},
      warns,
    )
    expect(found.map(({ name }) => name)).toEqual(['p_ok'])
    expect(JSON.stringify(warns)).toContain('LOCALIX_TEST_UNSET_VARIABLE')
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
