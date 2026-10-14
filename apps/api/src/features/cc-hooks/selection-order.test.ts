import { expect, test } from 'bun:test'
import { createCcHooksRuntime } from './run'
import type { CcHookHandler } from './contracts'

const logger = { warn: () => {} }

test('a failed guard leaves a once hook available, while a selected denial spends it', async () => {
  const onceKeys = new Set<string>()
  const calls: string[] = []
  const runtime = createCcHooksRuntime({
    enabled: true,
    sessionId: 'selection-order',
    projectDir: '.',
    logger,
    onceKeys,
    registry: {
      PreToolUse: [
        {
          handlers: [
            {
              source: 'plugin',
              kind: 'prompt',
              command: '',
              prompt: 'check',
              timeoutMs: 1000,
              if: 'Bash(echo allowed)',
              once: true,
            },
          ],
        },
      ],
    },
    evaluatePromptHook: async ({ inputJson }) => {
      calls.push(JSON.parse(inputJson).tool_input.command)
      return { ok: false, reason: 'blocked once' }
    },
  })
  expect(await runtime.runPreToolUse('bash', { command: 'echo other' })).toEqual({
    decision: 'proceed',
    didRewrite: false,
  })
  expect(onceKeys.size).toBe(0)
  expect(calls).toEqual([])
  expect(await runtime.runPreToolUse('bash', { command: 'echo allowed' })).toMatchObject({
    decision: 'deny',
    reason: 'blocked once',
  })
  expect(onceKeys.size).toBe(1)
  expect(await runtime.runPreToolUse('bash', { command: 'echo allowed' })).toEqual({
    decision: 'proceed',
    didRewrite: false,
  })
  expect(calls).toEqual(['echo allowed'])
})

test('source filtering happens before inspecting guards or spending once hooks', async () => {
  const onceKeys = new Set<string>()
  let guardReads = 0
  let evaluated = 0
  const handler: CcHookHandler = {
    source: 'user',
    kind: 'prompt',
    command: '',
    prompt: 'check',
    timeoutMs: 1000,
    once: true,
    get if() {
      guardReads++
      return undefined
    },
  }
  const runtime = createCcHooksRuntime({
    enabled: true,
    sessionId: 'source-order',
    projectDir: '.',
    logger,
    onceKeys,
    registry: { SubagentStop: [{ handlers: [handler] }] },
    evaluatePromptHook: async () => {
      evaluated++
      return { ok: true }
    },
  })
  expect(await runtime.runSubagentStop('child', 'id', null, { sourcesOnly: ['skill'] })).toEqual({
    blocked: false,
  })
  expect(guardReads).toBe(0)
  expect(onceKeys.size).toBe(0)
  expect(evaluated).toBe(0)
  await runtime.runSubagentStop('child', 'id', null, { sourcesOnly: ['user'] })
  expect(guardReads).toBe(1)
  expect(onceKeys.size).toBe(1)
  expect(evaluated).toBe(1)
  await runtime.runSubagentStop('child', 'id', null)
  expect(evaluated).toBe(1)
})
