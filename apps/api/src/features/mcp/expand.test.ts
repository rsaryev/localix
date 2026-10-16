import { describe, it, expect } from 'bun:test'

import { expandString, expandServerConfig } from './expand'

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

  it('expands an unset ${VAR} with no default to empty string', () => {
    expect(expandString('a${MISSING}b', env)).toBe('ab')
  })

  it('supports multiple substitutions and paths', () => {
    expect(expandString('${HOME_DIR}/bin/${FOO}', env)).toBe('/home/u/bin/bar')
  })
})

describe('expandServerConfig', () => {
  it('expands command, args, env, url, and headers', () => {
    const env = { TOKEN: 'sekret', BASE: 'https://api.example.com' }
    const out = expandServerConfig(
      {
        command: ['${MISSING:-node}', 'server.js'],
        args: ['--url', '${BASE}/mcp'],
        env: { AUTH: 'Bearer ${TOKEN}' },
        url: '${BASE}/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
        // untouched passthrough fields:
        timeout: 5000,
      },
      { env },
    )
    expect(out.command).toEqual(['node', 'server.js'])
    expect(out.args).toEqual(['--url', 'https://api.example.com/mcp'])
    expect(out.env).toEqual({ AUTH: 'Bearer sekret' })
    expect(out.url).toBe('https://api.example.com/mcp')
    expect(out.headers).toEqual({ Authorization: 'Bearer sekret' })
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
