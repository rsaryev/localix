import { describe, expect, test } from 'bun:test'

import { connectServerConfig, serverTimeouts } from './mcp-connect'

/**
 * What a server of `mcp`'s registry connects with: the kit's expansion over Localix's record shape
 * (a stdio command as one array), with Localix's wider credential net toward a remote server.
 */
describe('a server config at connect time', () => {
  const env = {
    BASE: 'https://x.example',
    TENANT: 'acme',
    EMPTY: '',
    GITHUB_TOKEN: 'ghp_host',
    HTTPS_PROXY: 'http://proxy',
  }

  test('expands the command array, args, env, url and headers and passes the rest', () => {
    const out = connectServerConfig(
      {
        config: {
          command: ['${MISSING:-node}', 'server.js'],
          args: ['--url', '${BASE}/mcp'],
          env: { TENANT: '${TENANT}' },
          url: '${BASE}/mcp',
          headers: { 'X-Tenant': '${TENANT}' },
          timeout: 5000,
        },
      },
      env,
    )
    expect(out).toEqual({
      command: ['node', 'server.js'],
      args: ['--url', 'https://x.example/mcp'],
      env: { TENANT: 'acme' },
      url: 'https://x.example/mcp',
      headers: { 'X-Tenant': 'acme' },
      timeout: 5000,
    })
  })

  test('an empty variable is set, so its default is not used, as in Claude Code', () => {
    expect(connectServerConfig({ config: { command: ['${EMPTY:-x}'] } }, env).command).toEqual([''])
  })

  test('withholds from a remote server the kit’s credential names and Localix’s wider net', () => {
    const out = connectServerConfig(
      {
        config: {
          url: '${BASE}/mcp?p=${HTTPS_PROXY}',
          headers: { Authorization: 'Bearer ${GITHUB_TOKEN}', 'X-Key': '${UNSET_API_KEY:-dflt}' },
        },
      },
      env,
    )
    expect(out.url).toBe('https://x.example/mcp?p=')
    expect(out.headers).toEqual({ Authorization: 'Bearer ', 'X-Key': '' })
  })

  test('still hands a local server its credentials', () => {
    const out = connectServerConfig(
      { config: { command: ['gh-mcp', '--token', '${GITHUB_TOKEN}'] } },
      env,
    )
    expect(out.command).toEqual(['gh-mcp', '--token', 'ghp_host'])
  })

  test('leaves a config resolved when it was built (a plugin server) as built', () => {
    const config = { url: 'https://x.example', headers: { X: '${TENANT}' } }
    const out = connectServerConfig({ config, configExpanded: true }, env)
    expect(out).toEqual(config)
    expect(out).not.toBe(config)
  })
})

describe('a server’s limits', () => {
  test('a remote server idles out after 5 minutes, a stdio one after 30, unless the env says', () => {
    expect(serverTimeouts({ transport: 'http', config: {} }, {}).idleMs).toBe(300_000)
    expect(serverTimeouts({ transport: 'stdio', config: {} }, {}).idleMs).toBe(1_800_000)
    const off = { CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '0' }
    expect(serverTimeouts({ transport: 'stdio', config: {} }, off).idleMs).toBeUndefined()
  })

  test('the record’s own timeout sets its tool-call limit', () => {
    const limits = serverTimeouts({ transport: 'ws', config: { timeout: 9000 } }, {})
    expect(limits.toolMs).toBe(9000)
  })
})
