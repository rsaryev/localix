import { describe, expect, test } from 'bun:test'
import { createCcHooksRuntime } from './run'
import type { CcHookHandler } from './contracts'

describe('lifecycle bounds at the compatibility adapter', () => {
  test('teardown hooks keep their own bounded lifetime after turn cancellation', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const runtime = createCcHooksRuntime({
      registry: {
        SessionEnd: [
          {
            handlers: [
              {
                source: 'agent',
                kind: 'mcp_tool',
                mcpTool: 'mcp_test_cleanup',
                command: '',
                timeoutMs: 1000,
              },
            ],
          },
        ],
      },
      signal: AbortSignal.abort(),
      sessionId: 'test',
      projectDir: process.cwd(),
      enabled: true,
      logger: { warn: () => {} },
      callMcpTool: async (_name, _input, signal) => {
        signals.push(signal)
        return { text: '' }
      },
    })
    await runtime.runSessionEnd('other')
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
  })
  test.each(['prompt', 'agent', 'mcp_tool'] as const)(
    '%s cannot hold the host past its deadline',
    async (kind) => {
      const signals: (AbortSignal | undefined)[] = []
      let calls = 0
      const gate = (options: { signal?: AbortSignal }): Promise<{ ok: boolean }> => {
        calls++
        signals.push(options.signal)
        return new Promise(() => {})
      }
      const handler: CcHookHandler = {
        source: 'skill',
        kind,
        command: '',
        prompt: 'Review',
        mcpTool: 'mcp_test_check',
        timeoutMs: 20,
        once: true,
      }
      const runtime = createCcHooksRuntime({
        registry: { PreToolUse: [{ handlers: [handler] }] },
        sessionId: 'test',
        projectDir: process.cwd(),
        enabled: true,
        onceKeys: new Set(),
        logger: { warn: () => {} },
        evaluatePromptHook: gate,
        runAgentHook: gate,
        callMcpTool: (_name, _input, signal) => {
          calls++
          signals.push(signal)
          return new Promise(() => {})
        },
      })
      expect((await runtime.runPreToolUse('read', {})).decision).toBe('proceed')
      expect(signals[0]?.aborted).toBe(true)
      // A `once` hook that timed out stays in place (hooks.md) and runs on the next event.
      await runtime.runPreToolUse('read', {})
      expect(calls).toBe(2)
    },
  )

  test('a pre-cancelled runtime neither invokes nor spends a once handler', async () => {
    const onceKeys = new Set<string>()
    let calls = 0
    const runtime = createCcHooksRuntime({
      registry: {
        Stop: [
          {
            handlers: [
              {
                source: 'skill',
                kind: 'prompt',
                prompt: 'Review',
                command: '',
                timeoutMs: 1000,
                once: true,
              },
            ],
          },
        ],
      },
      signal: AbortSignal.abort(),
      sessionId: 'test',
      projectDir: process.cwd(),
      enabled: true,
      onceKeys,
      logger: { warn: () => {} },
      evaluatePromptHook: async () => {
        calls++
        return { ok: false }
      },
    })
    expect(await runtime.runStop()).toEqual({ blocked: false })
    expect(calls).toBe(0)
    expect(onceKeys.size).toBe(0)
  })
})
