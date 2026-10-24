import { afterEach, describe, expect, test } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { buildToolForServer, resolveToolTimeoutMs } from './mcp-tools'
import type { McpServerRecord } from './repository'

/**
 * How long an MCP tool call may run, as Claude Code bounds it (mcp.md, "Time limits on MCP tool
 * calls"): a long wall-clock limit (`timeout`, else `MCP_TOOL_TIMEOUT`, else about 28 hours), and
 * an idle window (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`) that progress notifications restart. The
 * delays here are the server's, injected short.
 */

const IDLE = 'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT'
const saved = { idle: process.env[IDLE], tool: process.env.MCP_TOOL_TIMEOUT }
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.()
  for (const [name, value] of [
    [IDLE, saved.idle],
    ['MCP_TOOL_TIMEOUT', saved.tool],
  ] as const)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A real SDK server with one tool that runs `ms`, reporting progress every `everyMs` if set. */
async function slowTool(ms: number, config: Record<string, unknown> = {}, everyMs?: number) {
  const server = new McpServer({ name: 'builds', version: '1.0.0' })
  server.registerTool('build', { description: 'Run the build' }, async (extra) => {
    const token = extra._meta?.progressToken
    const started = Date.now()
    while (Date.now() - started < ms) {
      await wait(everyMs ?? ms)
      if (everyMs && token !== undefined)
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken: token, progress: Date.now() - started },
        })
    }
    return { content: [{ type: 'text', text: 'built' }] }
  })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'localix', version: '1.0.0' })
  await client.connect(clientSide)
  closers.push(async () => {
    await client.close()
    await server.close()
  })
  const record: McpServerRecord = {
    id: 'srv-builds',
    userId: 'u',
    projectId: '',
    name: 'builds',
    description: '',
    transport: 'stdio',
    config,
    createdAt: '',
    updatedAt: '',
  }
  const tool = buildToolForServer(record, client, {
    name: 'build',
    inputSchema: { type: 'object', properties: {} },
  })
  return () => tool.execute('call-1', {}, undefined, undefined, {} as never)
}

describe('MCP tool call time limits', () => {
  test('with no timeout configured, a call may run for hours, not 30 seconds', () => {
    delete process.env.MCP_TOOL_TIMEOUT
    expect(resolveToolTimeoutMs({})).toBeGreaterThan(24 * 60 * 60 * 1000)
  })

  test('a server that goes silent for the idle window fails the call', async () => {
    process.env[IDLE] = '60'
    const result = await (await slowTool(400))()
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('timed out')
  })

  test('progress notifications keep a long call alive past the idle window', async () => {
    process.env[IDLE] = '80'
    const result = await (await slowTool(300, {}, 20))()
    expect(result.isError).not.toBe(true)
    expect(String(result.content)).toBe('built')
  })

  test('an idle window of 0 turns the check off', async () => {
    process.env[IDLE] = '0'
    const result = await (await slowTool(150))()
    expect(String(result.content)).toBe('built')
  })

  test("a server's own timeout is the floor of its idle window", async () => {
    process.env[IDLE] = '40'
    const result = await (await slowTool(150, { timeout: 2_000 }))()
    expect(String(result.content)).toBe('built')
  })
})
