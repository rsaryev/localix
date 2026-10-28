import { expect, test } from 'bun:test'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { createHitlRegistry } from '../hitl-registry'
import type { SessionStreamRegistry } from '../session-stream-registry'
import { requestInvocationApproval } from './invocation-approval'

const agent = agentDefinitionSchema.parse({
  id: 'builtin:localix',
  name: 'localix',
  description: '',
  instructions: 'Work',
})

test('invocation approval is shown in the verified chat and covers one attempt', async () => {
  const hitlRegistry = createHitlRegistry()
  const frames: unknown[] = []
  const streamRegistry = {
    publish: (...args: unknown[]) => frames.push(args),
  } as unknown as SessionStreamRegistry
  const signal = new AbortController().signal
  const pending = requestInvocationApproval({
    hitlRegistry,
    streamRegistry,
    userId: 'u',
    targetSessionId: 'root',
    sourceSessionId: 'child',
    assistantMessageId: 'message',
    agent,
    host: 'delegation',
    signal,
  })
  const shown = hitlRegistry.getPendingInteraction('root')
  expect(shown?.title).toBe('Start localix')
  expect(hitlRegistry.getPendingInteraction('child')).toBeNull()
  expect(hitlRegistry.getRequestMeta(shown!.requestId)?.sourceSessionId).toBe('child')
  expect(frames).toHaveLength(1)
  expect(() => hitlRegistry.respond(shown!.requestId, { confirmed: true }, 'other')).toThrow()
  hitlRegistry.respond(shown!.requestId, { confirmed: true, scope: 'session' }, 'u')
  expect(await pending).toBe('approved')
  expect(hitlRegistry.getPendingInteraction('root')).toBeNull()
})

test('cancelled invocation never leaves a pending approval', async () => {
  const hitlRegistry = createHitlRegistry()
  const controller = new AbortController()
  const pending = requestInvocationApproval({
    hitlRegistry,
    streamRegistry: { publish: () => {} } as unknown as SessionStreamRegistry,
    userId: 'u',
    targetSessionId: 'root',
    sourceSessionId: 'root',
    assistantMessageId: 'message',
    agent,
    host: 'chat',
    signal: controller.signal,
  })
  expect(hitlRegistry.getPendingInteraction('root')).not.toBeNull()
  controller.abort()
  expect(await pending).toBe('declined')
  expect(hitlRegistry.getPendingInteraction('root')).toBeNull()
})
