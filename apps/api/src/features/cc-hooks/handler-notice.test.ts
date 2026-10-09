import { expect, test } from 'bun:test'
import { createCcHooksRuntime } from './run'
import type { CcHookHandler, CcHookRegistry } from './contracts'

const handler: CcHookHandler = {
  source: 'plugin',
  kind: 'mcp_tool',
  command: '',
  mcpTool: 'notice',
  timeoutMs: 1000,
}

test('notice memory spans events and empty outcomes, and remains local to each runtime', async () => {
  const notices: string[] = []
  const registry: CcHookRegistry = {
    PreToolUse: [{ handlers: [handler] }],
    PostToolUse: [{ handlers: [handler] }],
    Stop: [{ handlers: [handler] }],
  }
  const messages = ['same', undefined, 'same', 'different', 'same']
  const makeRuntime = () =>
    createCcHooksRuntime({
      registry,
      sessionId: 'notice-memory',
      projectDir: '.',
      enabled: true,
      logger: { warn: () => {} },
      callMcpTool: async () => ({ text: JSON.stringify({ systemMessage: messages.shift() }) }),
      emitNotice: (message, event) => {
        notices.push(`${event}:${message}`)
      },
    })
  const runtime = makeRuntime()
  await runtime.runPreToolUse('bash', {})
  await runtime.runPostToolUse('bash', {}, { content: 'done' })
  await runtime.runStop()
  await runtime.runPreToolUse('bash', {})
  await runtime.runPreToolUse('bash', {})
  expect(notices).toEqual(['PreToolUse:same', 'PreToolUse:different', 'PreToolUse:same'])
  messages.push('same')
  await makeRuntime().runPreToolUse('bash', {})
  expect(notices.at(-1)).toBe('PreToolUse:same')
  expect(notices).toHaveLength(4)
})

test('a failed notice sink is logged and does not retry an identical notice', async () => {
  const warnings: string[] = []
  let attempts = 0
  const runtime = createCcHooksRuntime({
    registry: { PreToolUse: [{ handlers: [handler] }] },
    sessionId: 'notice-failure',
    projectDir: '.',
    enabled: true,
    logger: {
      warn: (message) => {
        warnings.push(message)
      },
    },
    callMcpTool: async () => ({ text: '{"systemMessage":"same"}' }),
    emitNotice: () => {
      attempts++
      throw new Error('sink failed')
    },
  })
  expect(await runtime.runPreToolUse('bash', {})).toEqual({
    decision: 'proceed',
    didRewrite: false,
  })
  await runtime.runPreToolUse('bash', {})
  expect(attempts).toBe(1)
  expect(warnings).toEqual(['[cc-hooks] emitNotice failed: Error: sink failed'])
})
