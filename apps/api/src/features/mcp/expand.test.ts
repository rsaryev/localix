import { describe, it, expect } from 'bun:test'

import { connectServerConfig, expandString, expandServerConfig } from './expand'

describe('expandString', () => {
  const env = { FOO: 'bar', EMPTY: '', HOME_DIR: '/home/u' }

  it('expands ${VAR}', () => {
    expect(expandString('x-${FOO}-y', env)).toBe('x-bar-y')
  })

  it('expands ${VAR:-default} to VAR when set', () => {
    expect(expandString('${FOO:-fallback}', env)).toBe('bar')
  })

  it('uses the default when the var is unset or empty', () => {
    expect(expandString('${MISSING:-def}', env)).toBe('def')
    expect(expandString('${EMPTY:-def}', env)).toBe('def')
  })

  it('keeps an unset ${VAR} with no default as written, as Claude Code does', () => {
    expect(expandString('a${MISSING}b', env)).toBe('a${MISSING}b')
  })

  it('supports multiple substitutions and paths', () => {
    expect(expandString('${HOME_DIR}/bin/${FOO}', env)).toBe('/home/u/bin/bar')
  })
})

describe('expandServerConfig', () => {
  it('expands command, args, env, url, and headers', () => {
    const env = { TENANT: 'sekret', BASE: 'https://api.example.com' }
    const out = expandServerConfig(
      {
        command: ['${MISSING:-node}', 'server.js'],
        args: ['--url', '${BASE}/mcp'],
        env: { AUTH: 'Bearer ${TENANT}' },
        url: '${BASE}/mcp',
        headers: { 'X-Tenant': '${TENANT}' },
        // untouched passthrough fields:
        timeout: 5000,
      },
      { env },
    )
    expect(out.command).toEqual(['node', 'server.js'])
    expect(out.args).toEqual(['--url', 'https://api.example.com/mcp'])
    expect(out.env).toEqual({ AUTH: 'Bearer sekret' })
    expect(out.url).toBe('https://api.example.com/mcp')
    expect(out.headers).toEqual({ 'X-Tenant': 'sekret' })
    expect(out.timeout).toBe(5000)
  })

  it('layers extraEnv (e.g. CLAUDE_PROJECT_DIR) over env', () => {
    const out = expandServerConfig(
      { command: ['echo', '${CLAUDE_PROJECT_DIR}'] },
      { env: {}, extraEnv: { CLAUDE_PROJECT_DIR: '/repo' } },
    )
    expect(out.command).toEqual(['echo', '/repo'])
  })
})

describe('credentials toward a remote server', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-host', GITHUB_TOKEN: 'ghp_host', BASE: 'https://x.example' }

  it('reads a credential name as empty in url and headers, ignoring its default', () => {
    const out = expandServerConfig(
      {
        url: '${BASE}/mcp?key=${ANTHROPIC_API_KEY}',
        headers: {
          Authorization: 'Bearer ${GITHUB_TOKEN}',
          'X-Key': '${UNSET_API_KEY:-fallback}',
        },
      },
      { env },
    )
    expect(out.url).toBe('https://x.example/mcp?key=')
    expect(out.headers).toEqual({ Authorization: 'Bearer ', 'X-Key': '' })
  })

  it('still hands a local server its credentials through args and env', () => {
    const out = expandServerConfig(
      { command: 'gh-mcp', args: ['--token', '${GITHUB_TOKEN}'], env: { KEY: '${GITHUB_TOKEN}' } },
      { env },
    )
    expect(out.args).toEqual(['--token', 'ghp_host'])
    expect(out.env).toEqual({ KEY: 'ghp_host' })
  })
})

describe('connectServerConfig', () => {
  const env = { ORG_ID: 'acme' }
  const config = { url: 'https://x.example', headers: { X: '${ORG_ID}' } }

  it('expands a record whose config was stored with its tokens', () => {
    expect(connectServerConfig({ config }, { env }).headers).toEqual({ X: 'acme' })
  })

  it('leaves an already-resolved config (a plugin server) as built', () => {
    const out = connectServerConfig({ config, configExpanded: true }, { env })
    expect(out).toEqual(config)
    expect(out).not.toBe(config)
  })
})
