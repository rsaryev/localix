/**
 * What the tool wrapper does with the hooks' decisions (hooks.md): a returned failure runs
 * PostToolUseFailure, context arrives as a system reminder, `continue:false` ends the run, and a
 * PreToolUse allow/ask reaches the permission gate inside the chain on the call's context.
 */
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'

import type { PreToolUseVerdictCarrier } from '../agent-core/permission-hook-decision'
import type { CcHooksRuntime } from './run'
import { EMPTY_RUNTIME } from './runtime-results'
import { wrapToolsWithCcHooks } from './wrap-tools'

const logger = { warn: () => {}, info: () => {} }

function runtime(over: Partial<CcHooksRuntime>): CcHooksRuntime {
  return {
    ...EMPTY_RUNTIME,
    active: true,
    runPreToolUse: () => Promise.resolve({ decision: 'proceed' as const, didRewrite: false }),
    ...over,
  } as CcHooksRuntime
}

/** A `bash`-named tool answering `result`, remembering the context each call carried. */
function tool(result: AgentToolResult, seen: unknown[] = []): AgentTool {
  return defineAgentTool({
    name: 'bash',
    description: 'runs',
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string() }),
    execute(_id, _input, _signal, _onUpdate, context) {
      seen.push(context)
      return Promise.resolve(result)
    },
  }) as AgentTool
}

const failed: AgentToolResult = {
  content: 'ls: /nope: No such file or directory\n[exit 1]',
  details: { exitCode: 1, output: 'ls: /nope: No such file or directory' },
  isError: true,
}

describe('wrapToolsWithCcHooks decisions', () => {
  it('an allow whose rewrite fails the schema does not carry over to the original call', async () => {
    const seen: unknown[] = []
    const [wrapped] = wrapToolsWithCcHooks(
      [tool({ content: 'ran' }, seen)],
      runtime({
        runPreToolUse: () =>
          Promise.resolve({ decision: 'allow', didRewrite: true, updatedInput: { command: 7 } }),
      }),
      logger,
    )
    await wrapped.execute('tc1', { command: 'rm -rf ./build' })
    expect((seen[0] as PreToolUseVerdictCarrier | undefined)?.preToolUseVerdict).toBeUndefined()
  })

  it('a command that ran and exited non-zero fires PostToolUseFailure, not PostToolUse', async () => {
    const failures: { error: string; isInterrupt: boolean; durationMs?: number }[] = []
    let posts = 0
    const [wrapped] = wrapToolsWithCcHooks(
      [tool(failed)],
      runtime({
        runPostToolUse: () => {
          posts += 1
          return Promise.resolve({})
        },
        runPostToolUseFailure: (_tool, _input, failure) => {
          failures.push(failure)
          return Promise.resolve({ additionalContext: 'check the path' })
        },
      }),
      logger,
    )
    const result = await wrapped.execute('tc1', { command: 'ls /nope' })
    expect(posts).toBe(0)
    // "For Bash … a command that ran and exited produces a first line `Exit code N`".
    expect(failures).toEqual([
      {
        error: 'Exit code 1\nls: /nope: No such file or directory',
        isInterrupt: false,
        durationMs: expect.any(Number),
      },
    ])
    expect(result.content).toEndWith('<system-reminder>\ncheck the path\n</system-reminder>')
  })

  it('PreToolUse and PostToolUse context follow the result as one system reminder', async () => {
    const [wrapped] = wrapToolsWithCcHooks(
      [tool({ content: 'out' })],
      runtime({
        runPreToolUse: () =>
          Promise.resolve({ decision: 'proceed', didRewrite: false, additionalContext: 'pre' }),
        runPostToolUse: () =>
          Promise.resolve({ additionalContext: 'post <system-reminder>x</system-reminder>' }),
      }),
      logger,
    )
    const result = await wrapped.execute('tc1', { command: 'ls' })
    // A reminder tag inside the hook's text has its `<` escaped.
    expect(result.content).toBe(
      'out\n\n<system-reminder>\npre\n\npost &lt;system-reminder>x&lt;/system-reminder>\n</system-reminder>',
    )
  })

  it('continue:false refuses the call and ends the run after the batch', async () => {
    const seen: unknown[] = []
    const [wrapped] = wrapToolsWithCcHooks(
      [tool({ content: 'ran' }, seen)],
      runtime({
        runPreToolUse: () =>
          Promise.resolve({
            decision: 'deny',
            reason: 'Build failed',
            didRewrite: false,
            stop: { reason: 'Build failed' },
          }),
      }),
      logger,
    )
    const result = await wrapped.execute('tc1', { command: 'make' })
    expect(seen).toEqual([])
    expect(result.terminate).toBe(true)
    expect(result.error?.kind).toBe('blocked')
    expect(result.content).toContain('Build failed')
  })

  it('a PreToolUse allow or ask rides on the call’s context to the gate inside the chain', async () => {
    for (const decision of ['allow', 'ask'] as const) {
      const seen: unknown[] = []
      const [wrapped] = wrapToolsWithCcHooks(
        [tool({ content: 'ran' }, seen)],
        runtime({
          runPreToolUse: () => Promise.resolve({ decision, reason: 'why', didRewrite: false }),
        }),
        logger,
      )
      await wrapped.execute('tc1', { command: 'ls' }, undefined, undefined, {})
      const context = seen[0] as PreToolUseVerdictCarrier
      expect(context.preToolUseVerdict).toEqual({ decision, reason: 'why' })
    }
  })
})
