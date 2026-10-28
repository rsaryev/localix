import { describe, expect, test as it } from 'bun:test'

import { normalizeMcpServerEntry } from './normalize'

describe('normalizeMcpServerEntry', () => {
  it('flattens stdio command + args into one command array', () => {
    const input = normalizeMcpServerEntry(
      'filesystem',
      {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { FOO: 'bar' },
      },
      null,
    )
    expect(input.transport).toBe('stdio')
    expect(input.config).toEqual({
      command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
    })
    expect(input.projectId).toBeNull()
  })

  it('treats a url entry as http transport', () => {
    const input = normalizeMcpServerEntry(
      'sentry',
      {
        url: 'https://mcp.sentry.dev/mcp',
        headers: { Authorization: 'Bearer x' },
      },
      'proj-1',
    )
    expect(input.transport).toBe('http')
    expect(input.config).toEqual({
      url: 'https://mcp.sentry.dev/mcp',
      headers: { Authorization: 'Bearer x' },
    })
    expect(input.projectId).toBe('proj-1')
  })

  it('collapses sse type into http', () => {
    const input = normalizeMcpServerEntry(
      'legacy',
      { type: 'sse', url: 'https://example.com/sse' },
      null,
    )
    expect(input.transport).toBe('http')
  })

  it('accepts command already given as an array', () => {
    const input = normalizeMcpServerEntry('local', { command: ['python', 'server.py'] }, null)
    expect(input.config).toEqual({ command: ['python', 'server.py'] })
  })

  it('throws when stdio has no command', () => {
    expect(() => normalizeMcpServerEntry('bad', { env: { X: '1' } }, null)).toThrow(/command/)
  })

  it('does NOT shell-split a command path with spaces when args is present (CC verbatim argv[0])', () => {
    const input = normalizeMcpServerEntry(
      'win',
      {
        command: 'C:\\Program Files\\nodejs\\node.exe',
        args: ['server.js'],
      },
      null,
    )
    expect(input.config).toEqual({ command: ['C:\\Program Files\\nodejs\\node.exe', 'server.js'] })
  })

  it('splits a one-line command only when there is no args array (Localix convenience)', () => {
    const input = normalizeMcpServerEntry('one', { command: 'npx -y @foo/bar' }, null)
    expect(input.config).toEqual({ command: ['npx', '-y', '@foo/bar'] })
  })

  it('coerces non-string env/header values instead of dropping the whole record', () => {
    const stdio = normalizeMcpServerEntry(
      's',
      { command: 'x', env: { PORT: 5432, DEBUG: true, NAME: 'a' } },
      null,
    )
    expect(stdio.config).toEqual({
      command: ['x'],
      env: { PORT: '5432', DEBUG: 'true', NAME: 'a' },
    })
    const http = normalizeMcpServerEntry('h', { url: 'https://x/mcp', headers: { 'X-N': 7 } }, null)
    expect((http.config as { headers: unknown }).headers).toEqual({ 'X-N': '7' })
  })

  it('carries CC timeout + tool-filter fields into the config', () => {
    const input = normalizeMcpServerEntry(
      't',
      {
        command: 'x',
        timeout: 5000,
        enabledTools: ['query'],
        disabledTools: ['drop'],
      },
      null,
    )
    expect(input.config).toEqual({
      command: ['x'],
      timeout: 5000,
      enabledTools: ['query'],
      disabledTools: ['drop'],
    })
  })

  it('accepts a url carrying a ${VAR} token (expanded at connect time)', () => {
    const input = normalizeMcpServerEntry(
      'e',
      { url: '${API_BASE:-https://api.example.com}/mcp' },
      null,
    )
    expect(input.transport).toBe('http')
    expect((input.config as { url: string }).url).toBe('${API_BASE:-https://api.example.com}/mcp')
  })

  it('accepts a dotted ecosystem server name', () => {
    const input = normalizeMcpServerEntry('io.github.foo', { command: 'x' }, null)
    expect(input.name).toBe('io.github.foo')
  })

  it('detects the ws / websocket transport', () => {
    expect(
      normalizeMcpServerEntry('a', { type: 'ws', url: 'wss://x/socket' }, null).transport,
    ).toBe('ws')
    expect(
      normalizeMcpServerEntry('b', { type: 'websocket', url: 'wss://x/socket' }, null).transport,
    ).toBe('ws')
    // A bare url with no type still defaults to http (lenient), not ws.
    expect(normalizeMcpServerEntry('c', { url: 'https://x/mcp' }, null).transport).toBe('http')
  })

  it('preserves the required startup contract from ecosystem config', () => {
    const stdio = normalizeMcpServerEntry('s', { command: 'x', required: true }, null)
    const http = normalizeMcpServerEntry(
      'h',
      { url: 'https://example.com/mcp', required: true },
      null,
    )

    expect(stdio.config).toEqual({ command: ['x'], required: true })
    expect(http.config).toEqual({ url: 'https://example.com/mcp', required: true })
  })

  it('throws when http has no url', () => {
    expect(() => normalizeMcpServerEntry('bad', { type: 'http' }, null)).toThrow(/url/)
  })

  it('defaults enabled to true, but honors a defaultEnabled override for inert import', () => {
    expect(normalizeMcpServerEntry('a', { command: 'x' }, null).enabled).toBe(true)
    expect(normalizeMcpServerEntry('b', { command: 'x' }, null, false).enabled).toBe(false)
    // an explicit per-entry `enabled` still wins over the default.
    expect(normalizeMcpServerEntry('c', { command: 'x', enabled: true }, null, false).enabled).toBe(
      true,
    )
  })

  describe('Claude Code headersHelper and oauth keys', () => {
    const remote = { type: 'http', url: 'https://mcp.example.com/mcp' }

    it('keeps a headersHelper next to the static headers', () => {
      const input = normalizeMcpServerEntry(
        'api',
        { ...remote, headers: { 'X-A': '1' }, headersHelper: '/opt/bin/auth.sh' },
        null,
      )
      expect(input.config).toMatchObject({
        headers: { 'X-A': '1' },
        headersHelper: '/opt/bin/auth.sh',
      })
    })

    it('reads the oauth block: scopes is one space-separated string, kept as the scope', () => {
      const input = normalizeMcpServerEntry(
        'api',
        {
          ...remote,
          oauth: {
            clientId: 'cid',
            callbackPort: 8080,
            authServerMetadataUrl: 'https://auth.example.com/.well-known/openid-configuration',
            scopes: 'channels:read chat:write',
          },
        },
        null,
      )
      expect(input.config).toMatchObject({
        oauth: {
          clientId: 'cid',
          callbackPort: 8080,
          authServerMetadataUrl: 'https://auth.example.com/.well-known/openid-configuration',
          scope: 'channels:read chat:write',
        },
      })
    })

    it('takes a callbackPort alone, and still reads the Localix scope key', () => {
      const input = normalizeMcpServerEntry(
        'api',
        { ...remote, oauth: { callbackPort: 9000, scope: 'read' } },
        null,
      )
      expect(input.config).toMatchObject({ oauth: { callbackPort: 9000, scope: 'read' } })
    })

    it('never takes a client secret from a file', () => {
      const input = normalizeMcpServerEntry(
        'api',
        { ...remote, oauth: { clientId: 'cid', clientSecret: 'shh' } },
        null,
      )
      expect(JSON.stringify(input.config)).not.toContain('shh')
    })

    it('refuses an authServerMetadataUrl that is not https, and a bad port', () => {
      expect(() =>
        normalizeMcpServerEntry(
          'api',
          { ...remote, oauth: { authServerMetadataUrl: 'http://auth.example.com/meta' } },
          null,
        ),
      ).toThrow(/https/)
      expect(() =>
        normalizeMcpServerEntry('api', { ...remote, oauth: { callbackPort: 70000 } }, null),
      ).toThrow(/callbackPort/)
    })

    it('keeps the headers of a web socket server', () => {
      for (const type of ['ws', 'websocket']) {
        const ws = normalizeMcpServerEntry(
          'w',
          { type, url: 'wss://x/socket', headers: { Authorization: 'Bearer t' } },
          null,
        )
        expect(ws.config).toHaveProperty('headers', { Authorization: 'Bearer t' })
      }
    })

    it('does not carry a headersHelper onto a web socket or stdio server', () => {
      const ws = normalizeMcpServerEntry(
        'w',
        { type: 'ws', url: 'wss://x/socket', headersHelper: 'echo {}' },
        null,
      )
      expect(ws.config).not.toHaveProperty('headersHelper')
      const stdio = normalizeMcpServerEntry('s', { command: 'x', headersHelper: 'echo {}' }, null)
      expect(stdio.config).not.toHaveProperty('headersHelper')
    })
  })
})
