import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { helperRequestHeaders, runHeadersHelper } from './headers-helper'
import type { McpServerRecord } from './repository'

/**
 * Claude Code's `headersHelper` (mcp.md, "headersHelper"): a shell command whose stdout is a JSON
 * object of headers, run fresh on each connection, given 10 seconds, started with the server's
 * name and URL in its environment; the dynamic headers win a name the static ones set.
 */
const dir = tempDirPerTest('mcp-headers-helper-')
const PATH = process.env.PATH ?? ''

const base = (over: Partial<Parameters<typeof runHeadersHelper>[0]> = {}) => ({
  command: `printf '{"X-Name":"%s","X-Url":"%s"}' "$CLAUDE_CODE_MCP_SERVER_NAME" "$CLAUDE_CODE_MCP_SERVER_URL"`,
  serverName: 'internal-api',
  serverUrl: 'https://mcp.example.com/mcp',
  cwd: dir(),
  stripCredentials: false,
  env: { PATH },
  ...over,
})

describe('running a headersHelper', () => {
  test('the helper learns the server it is for and prints the headers', async () => {
    expect(await runHeadersHelper(base())).toEqual({
      'X-Name': 'internal-api',
      'X-Url': 'https://mcp.example.com/mcp',
    })
  })

  test('a project or plugin server’s helper loses credential-looking variables; a user server’s keeps them', async () => {
    const command = `printf '{"a":"%s","b":"%s","c":"%s","d":"%s"}' "$MY_REGISTRY_TOKEN" "$SOME_KEY" "$AUTH_FILE" "$KEEP"`
    const env = { PATH, MY_REGISTRY_TOKEN: 't', SOME_KEY: 'k', AUTH_FILE: 'f', KEEP: 'ok' }
    expect(await runHeadersHelper(base({ command, env, stripCredentials: true }))).toEqual({
      a: '',
      b: '',
      c: '',
      d: 'ok',
    })
    expect(await runHeadersHelper(base({ command, env }))).toEqual({
      a: 't',
      b: 'k',
      c: 'f',
      d: 'ok',
    })
  })

  test('a plugin’s helper runs in the plugin directory with CLAUDE_PLUGIN_ROOT set', async () => {
    const root = join(dir(), 'plugin')
    writeTree(root, { '.keep': '' })
    const out = await runHeadersHelper(
      base({
        command: `printf '{"root":"%s","cwd":"%s"}' "$CLAUDE_PLUGIN_ROOT" "$(pwd -P)"`,
        cwd: root,
        pluginRoot: root,
      }),
    )
    expect(out.root).toBe(root)
    expect(out.cwd.endsWith('/plugin')).toBe(true)
  })

  test('only string values are headers', async () => {
    expect(await runHeadersHelper(base({ command: `printf '{"a":"1","b":2,"c":null}'` }))).toEqual({
      a: '1',
    })
  })

  test('output that is not a JSON object, a failing exit, and a helper over its time all fail', async () => {
    await expect(runHeadersHelper(base({ command: 'echo nope' }))).rejects.toThrow(/JSON object/)
    await expect(runHeadersHelper(base({ command: `echo '["a"]'` }))).rejects.toThrow(/JSON object/)
    await expect(runHeadersHelper(base({ command: 'exit 3' }))).rejects.toThrow(/failed/)
    await expect(runHeadersHelper(base({ command: 'sleep 30', timeoutMs: 50 }))).rejects.toThrow(
      /failed/,
    )
  })
})

const record = (id: string, config: Record<string, unknown>): McpServerRecord => ({
  id,
  userId: 'u',
  projectId: '',
  name: 'api',
  description: '',
  transport: 'http',
  config,
  createdAt: '',
  updatedAt: '',
})

describe('the headers a server is sent', () => {
  const config = {
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'static', 'X-Keep': 'k' },
    headersHelper: `printf '{"Authorization":"dynamic"}'`,
  }

  test('the helper’s headers win a name the static headers set', async () => {
    const got = await helperRequestHeaders(record('claude-code:user:api', config), config, dir(), {
      env: { PATH },
    })
    expect(got.headers).toEqual({ Authorization: 'dynamic', 'X-Keep': 'k' })
    expect(got.helped).toBe(true)
    expect(await got.refresh?.()).toEqual({ Authorization: 'dynamic', 'X-Keep': 'k' })
  })

  test('a server with no helper sends its static headers, and never runs anything', async () => {
    const plain = { url: config.url, headers: { 'X-Keep': 'k' } }
    const got = await helperRequestHeaders(record('claude-code:user:api', plain), plain, dir())
    expect(got.headers).toEqual({ 'X-Keep': 'k' })
    expect(got.helped).toBe(false)
  })

  test('a server of Localix’s own registry never runs a helper', async () => {
    const got = await helperRequestHeaders(record('own-1', config), config, dir(), {
      env: { PATH },
    })
    expect(got.headers).toEqual({ Authorization: 'static', 'X-Keep': 'k' })
    expect(got.helped).toBe(false)
  })

  test('a plugin’s http server runs it from the plugin directory', async () => {
    const root = join(dir(), 'p')
    writeTree(root, { '.keep': '' })
    const withRoot = {
      ...config,
      headersHelper: `printf '{"X-Root":"%s"}' "$CLAUDE_PLUGIN_ROOT"`,
      headersHelperRoot: root,
    }
    const got = await helperRequestHeaders(record('plugin:p:api', withRoot), withRoot, dir(), {
      env: { PATH },
    })
    expect(got.headers['X-Root']).toBe(root)
  })
})
