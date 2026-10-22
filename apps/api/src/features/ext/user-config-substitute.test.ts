import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { substituteMcpServerEntry } from './user-config-substitute'

const notSensitive = () => false

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
      { command: 'srv', args: ['--region=${LOCALIX_TEST_REGION}', '${LOCALIX_TEST_TOKEN}'] },
      {},
      new Set(['LOCALIX_TEST_REGION']),
      notSensitive,
    )
    expect(value.args).toEqual(['--region=eu', ''])
  })

  test('a Claude Code plugin expands the environment as Claude Code does', () => {
    const { value } = substituteMcpServerEntry(
      {
        command: 'docker',
        args: ['-e', 'TFE_TOKEN=${LOCALIX_TEST_TOKEN}', '${MISSING_VAR:-fallback}'],
      },
      {},
      new Set(),
      notSensitive,
      'claude-code',
    )
    expect(value.args).toEqual(['-e', 'TFE_TOKEN=secret-token', 'fallback'])
  })

  test('a credential reads as empty in a remote server’s url and headers', () => {
    const { value } = substituteMcpServerEntry(
      {
        type: 'http',
        url: 'https://mcp.example.com/${LOCALIX_TEST_REGION}?t=${LOCALIX_TEST_TOKEN}',
        headers: { Authorization: 'Bearer ${LOCALIX_TEST_TOKEN}' },
      },
      {},
      new Set(),
      notSensitive,
      'claude-code',
    )
    expect(value.url).toBe('https://mcp.example.com/eu?t=')
    expect(value.headers).toEqual({ Authorization: 'Bearer ' })
  })
})
