import { describe, expect, test } from 'bun:test'

import { mcpServerShape, readServerShape } from './mcp-record'

/**
 * A Claude Code server entry as the Localix record it connects through: the kit reads the entry
 * (`readMcpServer`, mcp.md "Option 2"; its `oauth` block with `readMcpOAuth`), and this keeps what
 * Localix's record stores.
 */
describe('a Claude Code MCP entry as a Localix record', () => {
  test('a stdio entry keeps its command line, its env and its timeout', () => {
    expect(
      readServerShape('fs', {
        command: 'C:\\Program Files\\node.exe',
        args: ['server.js', '/tmp'],
        env: { FOO: 'bar' },
        timeout: 30000,
      }),
    ).toEqual({
      name: 'fs',
      transport: 'stdio',
      config: {
        command: ['C:\\Program Files\\node.exe', 'server.js', '/tmp'],
        env: { FOO: 'bar' },
        timeout: 30000,
      },
    })
  })

  test('sse and streamable-http reach the server over http, ws over a socket', () => {
    const remote = (type: string) =>
      readServerShape('r', { type, url: 'https://x.example/mcp' })?.transport
    expect(remote('sse')).toBe('http')
    expect(remote('streamable-http')).toBe('http')
    expect(remote('ws')).toBe('ws')
  })

  test('an entry Claude Code drops does not load: a url with no type, a command list', () => {
    expect(readServerShape('u', { url: 'https://x.example/mcp' })).toBeUndefined()
    expect(readServerShape('c', { command: ['python', 'server.py'] })).toBeUndefined()
    expect(readServerShape('e', { type: 'http' })).toBeUndefined()
  })

  test('the oauth block is read as Claude Code reads it: scopes kept, a secret never', () => {
    const shape = readServerShape('api', {
      type: 'http',
      url: 'https://x.example/mcp',
      headersHelper: 'print-headers',
      oauth: { clientId: 'id', scopes: 'read write', callbackPort: 8080, clientSecret: 's' },
    })
    expect(shape?.config).toEqual({
      url: 'https://x.example/mcp',
      headersHelper: 'print-headers',
      oauth: { clientId: 'id', scope: 'read write', callbackPort: 8080 },
    })
  })

  test('a ws server keeps its headers helper, which Claude Code runs for it too', () => {
    const shape = mcpServerShape('w', { type: 'ws', url: 'wss://x.example/s', headersHelper: 'h' })
    expect(shape?.config).toMatchObject({ headersHelper: 'h' })
  })
})
