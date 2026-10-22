import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { McpShellUserConfigError, substituteMcpServerEntry } from './user-config-substitute'

describe('substituteMcpServerEntry environment policy', () => {
  beforeEach(() => {
    process.env.LOCALIX_TEST_REGION = 'eu'
    process.env.LOCALIX_TEST_TOKEN = 'secret-token'
  })
  afterEach(() => {
    delete process.env.LOCALIX_TEST_REGION
    delete process.env.LOCALIX_TEST_TOKEN
  })

  test('a legacy manifest reads only the variables it declared', () => {
    const { value } = substituteMcpServerEntry(
      'srv',
      { command: 'srv', args: ['--region=${LOCALIX_TEST_REGION}', '${LOCALIX_TEST_TOKEN}'] },
      {},
      new Set(['LOCALIX_TEST_REGION']),
    )
    expect(value.args).toEqual(['--region=eu', ''])
  })

  test('a Claude Code plugin expands the environment as Claude Code does', () => {
    const { value } = substituteMcpServerEntry(
      'srv',
      {
        command: 'docker',
        args: ['-e', 'TFE_TOKEN=${LOCALIX_TEST_TOKEN}', '${MISSING_VAR:-fallback}'],
      },
      {},
      new Set(),
      'claude-code',
    )
    expect(value.args).toEqual(['-e', 'TFE_TOKEN=secret-token', 'fallback'])
  })

  test('a credential reads as empty in a remote server’s url and headers', () => {
    const { value } = substituteMcpServerEntry(
      'srv',
      {
        type: 'http',
        url: 'https://mcp.example.com/${LOCALIX_TEST_REGION}?t=${LOCALIX_TEST_TOKEN}',
        headers: { Authorization: 'Bearer ${LOCALIX_TEST_TOKEN}' },
      },
      {},
      new Set(),
      'claude-code',
    )
    expect(value.url).toBe('https://mcp.example.com/eu?t=')
    expect(value.headers).toEqual({ Authorization: 'Bearer ' })
  })
})

describe('substituteMcpServerEntry plugin options', () => {
  test('an option substitutes in every non-shell field, including url and headers', () => {
    const { value } = substituteMcpServerEntry(
      'srv',
      {
        url: 'https://mcp.example.com/?t=${user_config.api_token}',
        headers: { Authorization: 'Bearer ${user_config.api_token}' },
      },
      { api_token: 'sk-live' },
      new Set(),
      'claude-code',
    )
    expect(value).toEqual({
      url: 'https://mcp.example.com/?t=sk-live',
      headers: { Authorization: 'Bearer sk-live' },
    })
  })

  test('headersHelper referencing an option is rejected on the template', () => {
    for (const helper of ['./h.sh ${user_config.api_token}', 'h ${CLAUDE_PLUGIN_OPTION_x:-y}']) {
      expect(() =>
        substituteMcpServerEntry(
          'internal-api',
          { url: 'https://x', headersHelper: helper },
          {},
          new Set(),
        ),
      ).toThrow(McpShellUserConfigError)
    }
    expect(() =>
      substituteMcpServerEntry(
        'internal-api',
        { url: 'https://x', headersHelper: './h.sh' },
        {},
        new Set(),
      ),
    ).not.toThrow()
  })
})
