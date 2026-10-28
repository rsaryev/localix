import { afterEach, describe, expect, test } from 'bun:test'

import { tempDirPerTest } from '@localixai/testing'

import { connectClient } from './mcp-connect'
import type { McpServerRecord } from './repository'

/** What a WebSocket MCP server RECEIVES in the upgrade request from a configured `headers`. */
const scratch = tempDirPerTest('mcp-ws-headers-')

let servers: Array<{ stop(force?: boolean): unknown }> = []
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop(true)))
  servers = []
})

/** A bare MCP endpoint over WebSocket that answers `initialize`. */
function wsEndpoint() {
  const seen: Headers[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, srv) {
      seen.push(request.headers)
      if (srv.upgrade(request)) return undefined
      return new Response('upgrade required', { status: 426 })
    },
    websocket: {
      message(ws, raw) {
        const body = JSON.parse(String(raw)) as { id?: number; method: string }
        if (body.method !== 'initialize') return
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'fake', version: '1' },
            },
          }),
        )
      },
    },
  })
  servers.push(server)
  return { url: `ws://127.0.0.1:${server.port}`, seen }
}

const record = (config: Record<string, unknown>): McpServerRecord => ({
  id: 'claude-code:project:sock',
  userId: 'u',
  projectId: '',
  name: 'sock',
  description: '',
  transport: 'ws',
  config,
  createdAt: '',
  updatedAt: '',
})

describe('a web socket server with headers', () => {
  test('receives the configured headers, expanded, in the upgrade request', async () => {
    const { url, seen } = wsEndpoint()
    const client = await connectClient(
      record({
        url,
        headers: { Authorization: 'Bearer ${PATH:-none}', 'X-Own': '1' },
      }),
      scratch(),
    )
    await client.close()
    expect(seen[0]?.get('authorization')).toBe(`Bearer ${process.env.PATH}`)
    expect(seen[0]?.get('x-own')).toBe('1')
  })

  test('still connects with no headers', async () => {
    const { url } = wsEndpoint()
    const client = await connectClient(record({ url }), scratch())
    await client.close()
  })
})
