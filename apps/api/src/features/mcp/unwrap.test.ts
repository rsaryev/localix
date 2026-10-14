import { describe, expect, test as it } from 'bun:test'

import { unwrapMcpServersBlob } from './unwrap'

describe('unwrapMcpServersBlob', () => {
  it('unwraps a Claude Desktop / .mcp.json mcpServers wrapper', () => {
    const map = unwrapMcpServersBlob({ mcpServers: { fs: { command: 'npx' } } })
    expect(Object.keys(map)).toEqual(['fs'])
  })

  it('unwraps a VS Code servers wrapper (the GitHub MCP paste)', () => {
    const map = unwrapMcpServersBlob({
      servers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/insiders' } },
    })
    expect(map.github).toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp/insiders' })
  })

  it('accepts a bare { name: entry } map', () => {
    const map = unwrapMcpServersBlob({ sentry: { url: 'https://mcp.sentry.dev/mcp' } })
    expect(Object.keys(map)).toEqual(['sentry'])
  })

  it('keeps a bare map whose server is literally named "servers"', () => {
    const map = unwrapMcpServersBlob({ servers: { command: 'npx', args: ['-y', 'thing'] } })
    expect(map.servers).toEqual({ command: 'npx', args: ['-y', 'thing'] })
  })

  it('rejects a single unnamed server entry with a naming hint', () => {
    expect(() => unwrapMcpServersBlob({ type: 'http', url: 'https://example.com/mcp' })).toThrow(
      /give it a name/,
    )
    expect(() => unwrapMcpServersBlob({ command: 'npx', args: ['-y', 'x'] })).toThrow(
      /give it a name/,
    )
  })

  it('rejects non-objects and empty maps', () => {
    expect(() => unwrapMcpServersBlob(null)).toThrow(/JSON object/)
    expect(() => unwrapMcpServersBlob([1, 2])).toThrow(/JSON object/)
    expect(() => unwrapMcpServersBlob('hi')).toThrow(/JSON object/)
    expect(() => unwrapMcpServersBlob({})).toThrow(/No servers found/)
    expect(() => unwrapMcpServersBlob({ mcpServers: {} })).toThrow(/No servers found/)
  })

  it('rejects a map whose value is not an object, naming the offender', () => {
    expect(() => unwrapMcpServersBlob({ good: { command: 'npx' }, bad: 5 })).toThrow(
      /"bad" is not a server object/,
    )
  })
})
