import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { matchesToolName } from './matcher'
import { createCcHooksRuntime, type CcHooksRuntime } from './run'
import { EMPTY_RUNTIME } from './runtime-results'
import { wrapToolsWithCcHooks } from './wrap-tools'

// A plugin `lin-mcp` with an `echo` server: Localix's engine name and Claude Code's.
const ENGINE = 'mcp_lin_mcp_echo_echo'
const CC = 'mcp__plugin_lin-mcp_echo__echo'
const PLUGIN_TOOL = {
  name: ENGINE,
  aliases: [CC],
  mcpServer: { name: 'plugin:lin-mcp:echo', source: 'plugin' },
}

describe('a plugin MCP tool as hook matchers see it', () => {
  it('never fires a matcher on the bare server key', () => {
    // "A hook matcher written against the bare server key ... never fires for a plugin-bundled
    // server." (mcp.md) The engine-form rewrite `mcp_echo_.*` matched inside the engine name.
    expect(matchesToolName('mcp__echo__.*', ENGINE, [CC])).toBe(false)
    expect(matchesToolName('mcp__echo__echo', ENGINE, [CC])).toBe(false)
  })

  it('fires the scoped matcher of a hyphenated plugin, as a regex and as an exact name', () => {
    expect(matchesToolName('mcp__plugin_lin-mcp_echo__.*', ENGINE, [CC])).toBe(true)
    expect(matchesToolName(CC, ENGINE, [CC])).toBe(true)
    expect(matchesToolName('mcp__plugin_lin-mcp_other__.*', ENGINE, [CC])).toBe(false)
  })

  it('still matches a matcher written in the engine form', () => {
    expect(matchesToolName(ENGINE, ENGINE, [CC])).toBe(true)
    expect(matchesToolName('mcp_lin_mcp_echo_.*', ENGINE, [CC])).toBe(true)
  })

  it('keeps the engine-form rewrites for a caller that knows the engine name alone', () => {
    expect(matchesToolName('mcp__memory__.*', 'mcp_memory_create')).toBe(true)
  })
})

/** A PreToolUse hook that refuses with its whole stdin as the reason (exit 2, stderr). */
function echoingRegistry(matcher: string): CcHookRegistry {
  const handler: CcHookHandler = { source: 'user', command: 'cat >&2; exit 2', timeoutMs: 5000 }
  return { PreToolUse: [{ matcher, handlers: [handler] }] }
}

describe('PreToolUse input for a plugin MCP tool', () => {
  it('carries Claude Code’s tool_name and the mcp_server object', async () => {
    const rt = createCcHooksRuntime({
      registry: echoingRegistry('mcp__plugin_lin-mcp_echo__.*'),
      sessionId: 's1',
      projectDir: tmpdir(),
      enabled: true,
      logger: { warn: () => {} },
    })
    const result = await rt.runPreToolUse(PLUGIN_TOOL, { text: 'ping' }, 'call-1')
    expect(result.decision).toBe('deny')
    const input = JSON.parse(result.reason ?? '{}')
    expect(input.tool_name).toBe(CC)
    expect(input.tool_input).toEqual({ text: 'ping' })
    expect(input.mcp_server).toEqual({ name: 'plugin:lin-mcp:echo', source: 'plugin' })
  })

  it('sends no mcp_server for a tool that is not an MCP tool', async () => {
    const rt = createCcHooksRuntime({
      registry: echoingRegistry('custom_tool'),
      sessionId: 's1',
      projectDir: tmpdir(),
      enabled: true,
      logger: { warn: () => {} },
    })
    const result = await rt.runPreToolUse('custom_tool', {})
    expect(JSON.parse(result.reason ?? '{}')).not.toHaveProperty('mcp_server')
  })
})

describe('wrapToolsWithCcHooks', () => {
  it('hands the hooks the tool itself, with its aliases and MCP server', async () => {
    const seen: unknown[] = []
    const tool = {
      ...defineAgentTool({
        name: ENGINE,
        description: 'echo',
        activeVerb: 'Running',
        inputSchema: z.object({}),
        execute: () => Promise.resolve({ content: 'ok' }),
      }),
      aliases: PLUGIN_TOOL.aliases,
      mcpServer: PLUGIN_TOOL.mcpServer,
    } as AgentTool
    const runtime = {
      ...EMPTY_RUNTIME,
      active: true,
      runPreToolUse: (ref: unknown) => {
        seen.push(ref)
        return Promise.resolve({ decision: 'proceed' as const, didRewrite: false })
      },
      runPostToolUse: (ref: unknown) => {
        seen.push(ref)
        return Promise.resolve({})
      },
    } as unknown as CcHooksRuntime
    const [wrapped] = wrapToolsWithCcHooks([tool], runtime, { warn: () => {}, info: () => {} })
    await wrapped.execute('call-1', {})
    expect(seen).toHaveLength(2)
    for (const ref of seen) expect(ref).toMatchObject(PLUGIN_TOOL)
  })
})
