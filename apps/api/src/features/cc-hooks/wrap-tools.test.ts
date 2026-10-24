import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import { CcHookBlockedError, wrapToolsWithCcHooks } from './wrap-tools'
import type { CcHooksRuntime } from './run'
import { EMPTY_RUNTIME } from './runtime-results'

/** A runtime with only the tool hooks the wrapper calls; the rest stays inert. */
function runtime(over: Partial<CcHooksRuntime>): CcHooksRuntime {
  return {
    ...EMPTY_RUNTIME,
    active: true,
    runPreToolUse: () => Promise.resolve({ decision: 'proceed' as const }),
    runPostToolUse: () => Promise.resolve({}),
    runPostToolUseFailure: () => Promise.resolve({}),
    ...over,
  } as CcHooksRuntime
}

const logger = { warn: () => {}, info: () => {} }

function throwingTool(): AgentTool {
  return defineAgentTool({
    name: 'boom',
    description: 'always fails',
    activeVerb: 'Booming',
    inputSchema: z.object({}),
    execute() {
      return Promise.reject(new Error('disk on fire'))
    },
  }) as AgentTool
}

describe('wrapToolsWithCcHooks', () => {
  it('runs PostToolUseFailure (not PostToolUse) on a THROWN tool error, as Claude Code does', async () => {
    const failures: unknown[] = []
    const posts: string[] = []
    const [tool] = wrapToolsWithCcHooks(
      [throwingTool()],
      runtime({
        runPostToolUse: (_name, _input, result) => {
          posts.push(result.content)
          return Promise.resolve({})
        },
        runPostToolUseFailure: (tool, _input, failure) => {
          failures.push({ name: typeof tool === 'string' ? tool : tool.name, ...failure })
          return Promise.resolve({ additionalContext: 'noted' })
        },
      }),
      logger,
    )
    const result = await tool.execute('tc1', {})
    expect(failures).toEqual([
      { name: 'boom', error: 'disk on fire', isInterrupt: false, durationMs: expect.any(Number) },
    ])
    expect(posts).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.error?.kind).toBe('execution')
    expect(result.content).toContain('disk on fire')
    expect(result.content).toContain('<system-reminder>\nnoted\n</system-reminder>')
  })

  it('a PreToolUse deny still throws, so the failure guard can stamp kind:blocked', async () => {
    const posts: string[] = []
    const [tool] = wrapToolsWithCcHooks(
      [throwingTool()],
      runtime({
        // `didRewrite` is required and means "the hooks replaced the input" — a deny rewrote
        // nothing, so it is false rather than absent.
        runPreToolUse: () =>
          Promise.resolve({ decision: 'deny' as const, reason: 'nope', didRewrite: false }),
        runPostToolUse: (_n, _i, r) => {
          posts.push(r.content)
          return Promise.resolve({})
        },
      }),
      logger,
    )
    await expect(tool.execute('tc1', {})).rejects.toBeInstanceOf(CcHookBlockedError)
    expect(posts).toEqual([])
  })

  it('a block thrown by the wrapper INSIDE (a plugin pre hook) is not converted', async () => {
    const blocked = defineAgentTool({
      name: 'inner',
      description: 'blocked by a plugin',
      activeVerb: 'Blocking',
      inputSchema: z.object({}),
      execute() {
        const err = new Error('Tool call blocked by plugin "guard": nope')
        err.name = 'ToolCallBlockedError'
        return Promise.reject(err)
      },
    }) as AgentTool
    const [tool] = wrapToolsWithCcHooks([blocked], runtime({}), logger)
    await expect(tool.execute('tc1', {})).rejects.toThrow('blocked by plugin')
  })
})
