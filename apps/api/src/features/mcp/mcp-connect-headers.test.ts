import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { connectClient, isMcpAuthenticationRequiredError } from './mcp-connect'
import type { McpServerRecord } from './repository'

/**
 * What a remote server RECEIVES from a Claude Code `.mcp.json` entry: its static headers with a
 * `headersHelper`'s output over them, the helper run again (once) after a 401 or 403, and no OAuth
 * fallback once the helper has supplied an `Authorization`.
 */
const scratch = tempDirPerTest('mcp-connect-headers-')

interface Seen {
  method: string
  path: string
  headers: Headers
}

let servers: Array<{ stop(force?: boolean): unknown }> = []
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop(true)))
  servers = []
})

/** A bare MCP endpoint that answers `initialize`, and 401s any request without `accept`ed auth. */
function mcpEndpoint(accept: (headers: Headers) => boolean, status = 401) {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url)
      seen.push({ method: request.method, path: url.pathname, headers: request.headers })
      if (url.pathname !== '/mcp') return new Response('not found', { status: 404 })
      if (!accept(request.headers)) return new Response('denied', { status })
      if (request.method !== 'POST') return new Response('', { status: 405 })
      const body = (await request.json()) as { id?: number; method: string }
      if (body.method !== 'initialize') return new Response('', { status: 202 })
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'fake', version: '1' },
        },
      })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/mcp`, seen }
}

const record = (
  config: Record<string, unknown>,
  id = 'claude-code:project:api',
): McpServerRecord => ({
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

/** A helper that prints `Bearer t0`, then `Bearer t1`, … on each run. */
const COUNTING = `n=$(cat count 2>/dev/null || echo 0); echo $((n+1)) > count; printf '{"Authorization":"Bearer t%s"}' $n`

describe('a remote server with a headersHelper', () => {
  test('receives the static headers with the helper’s over them', async () => {
    const { url, seen } = mcpEndpoint(() => true)
    const client = await connectClient(
      record({
        url,
        headers: { 'X-Static': 's', 'X-Both': 'static' },
        headersHelper: `printf '{"X-Both":"dynamic","X-Name":"%s"}' "$CLAUDE_CODE_MCP_SERVER_NAME"`,
      }),
      scratch(),
    )
    await client.close()
    const first = seen.find((s) => s.method === 'POST')
    expect(first?.headers.get('x-static')).toBe('s')
    expect(first?.headers.get('x-both')).toBe('dynamic')
    expect(first?.headers.get('x-name')).toBe('api')
  })

  test('is sent fresh headers on a reconnect: the helper runs on each connection', async () => {
    const { url, seen } = mcpEndpoint(() => true)
    const cwd = scratch()
    const config = { url, headersHelper: COUNTING }
    for (const _ of [1, 2]) await (await connectClient(record(config), cwd)).close()
    const tokens = seen
      .filter((s) => s.method === 'POST')
      .map((s) => s.headers.get('authorization'))
    expect(tokens[0]).toBe('Bearer t0')
    expect(tokens).toContain('Bearer t1')
  })

  test('after a 401 the helper runs again and the request is retried once with its headers', async () => {
    const { url, seen } = mcpEndpoint((h) => h.get('authorization') === 'Bearer t1')
    const client = await connectClient(record({ url, headersHelper: COUNTING }), scratch())
    await client.close()
    const posts = seen.filter((s) => s.method === 'POST').map((s) => s.headers.get('authorization'))
    expect(posts.slice(0, 2)).toEqual(['Bearer t0', 'Bearer t1'])
  })

  test('a rejected helper credential is a plain connect failure, not a request to sign in', async () => {
    const { url, seen } = mcpEndpoint(() => false)
    const error = await connectClient(
      record({ url, headersHelper: `printf '{"Authorization":"Bearer nope"}'` }),
      scratch(),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(isMcpAuthenticationRequiredError(error)).toBe(false)
    // No OAuth discovery was attempted: the helper's credential is the server's authentication.
    expect(seen.some((s) => s.path.includes('.well-known'))).toBe(false)
  })

  test('a failing helper fails the connection with its own message', async () => {
    const { url, seen } = mcpEndpoint(() => true)
    const error = await connectClient(record({ url, headersHelper: 'exit 2' }), scratch()).catch(
      (e: unknown) => e,
    )
    expect(String(error)).toContain('headersHelper')
    expect(seen).toHaveLength(0)
  })

  test('a server of Localix’s own registry never runs a helper', async () => {
    const { url, seen } = mcpEndpoint(() => true)
    const marker = join(scratch(), 'ran')
    const client = await connectClient(
      record({ url, headers: { 'X-Static': 's' }, headersHelper: `touch ${marker}` }, 'own-1'),
      scratch(),
    )
    await client.close()
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(seen.find((s) => s.method === 'POST')?.headers.get('x-static')).toBe('s')
  })
})
