/**
 * A plugin MCP tool under a handler's `if` field and under the PermissionRequest and
 * PermissionDenied events: each reads the tool by its Claude Code name, as PreToolUse does.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { evaluateIfGuard } from './if-guard'
import { createCcHooksRuntime } from './run'

// A plugin `lin-mcp` with an `echo` server: Localix's engine name and Claude Code's.
const ENGINE = 'mcp_lin_mcp_echo_echo'
const CC = 'mcp__plugin_lin-mcp_echo__echo'
const PLUGIN_TOOL = {
  name: ENGINE,
  aliases: [CC],
  mcpServer: { name: 'plugin:lin-mcp:echo', source: 'plugin' },
}

const dir = tempDirPerTest('cc-mcp-gate-')
const cmd = (command: string, extra: Partial<CcHookHandler> = {}): CcHookHandler => ({
  source: 'plugin',
  command,
  timeoutMs: 5000,
  ...extra,
})
const json = (value: unknown) => `echo '${JSON.stringify(value)}'`
const make = (registry: CcHookRegistry) =>
  createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: { warn: () => {}, info: () => {} },
  })

describe('a handler `if` on a plugin MCP tool', () => {
  it('matches the scoped name of a hyphenated plugin (hooks.md)', () => {
    expect(evaluateIfGuard(CC, ENGINE, {}, [CC])).toBe(true)
    expect(evaluateIfGuard('mcp__plugin_lin-mcp_other__echo', ENGINE, {}, [CC])).toBe(false)
    expect(evaluateIfGuard('mcp__echo__echo', ENGINE, {}, [CC])).toBe(false)
  })

  it('lets a PreToolUse hook guarded by that name run', async () => {
    const rt = make({
      PreToolUse: [
        {
          matcher: 'mcp__plugin_lin-mcp_echo__.*',
          handlers: [cmd('cat >/dev/null; echo guarded >&2; exit 2', { if: CC })],
        },
      ],
    })
    const result = await rt.runPreToolUse(PLUGIN_TOOL, { text: 'ping' }, 'call-1')
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('guarded')
  })
})

describe('PermissionRequest and PermissionDenied on a plugin MCP tool', () => {
  const deny = { hookSpecificOutput: { decision: { behavior: 'deny', message: 'hit' } } }
  const retry = { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } }
  const capture = (name: string, then: string) => cmd(`cat > "${join(dir(), name)}"; ${then}`)
  const input = (name: string) => JSON.parse(readFileSync(join(dir(), name), 'utf8'))

  it('fires the scoped matcher and hands the hook Claude Code’s name and server', async () => {
    const rt = make({
      PermissionRequest: [
        { matcher: 'mcp__plugin_lin-mcp_echo__.*', handlers: [capture('pr.json', json(deny))] },
      ],
      PermissionDenied: [
        { matcher: 'mcp__plugin_lin-mcp_echo__.*', handlers: [capture('pd.json', json(retry))] },
      ],
    })
    expect(await rt.runPermissionRequest(PLUGIN_TOOL, { text: 'ping' })).toEqual({
      behavior: 'deny',
      message: 'hit',
    })
    expect(input('pr.json')).toMatchObject({ tool_name: CC, mcp_server: PLUGIN_TOOL.mcpServer })
    expect(await rt.runPermissionDenied(PLUGIN_TOOL, {}, 'tc1', 'denied')).toEqual({ retry: true })
    expect(input('pd.json')).toMatchObject({ tool_name: CC, mcp_server: PLUGIN_TOOL.mcpServer })
  })

  it('never fires a matcher on the bare server key', async () => {
    const rt = make({
      PermissionRequest: [
        { matcher: 'mcp__echo__.*', handlers: [cmd(`cat >/dev/null; ${json(deny)}`)] },
      ],
      PermissionDenied: [
        { matcher: 'mcp__echo__.*', handlers: [cmd(`cat >/dev/null; ${json(retry)}`)] },
      ],
    })
    expect(await rt.runPermissionRequest(PLUGIN_TOOL, {})).toEqual({})
    expect(await rt.runPermissionDenied(PLUGIN_TOOL, {}, 'tc1', 'denied')).toEqual({ retry: false })
  })
})
