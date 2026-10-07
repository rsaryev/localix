import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import { buildAgentsOptions } from './agents-options'
import {
  buildTaskDelegationOptions,
  type TaskDelegationOptionsInput,
} from './task-delegation-options'
import { setAgentService } from '../agent-service-binding'

beforeEach(() => {
  setAgentService({ resolveDelegateAgent: async () => null, wakeSession: async () => {} } as never)
})
afterEach(() => setAgentService(null as never))

const input = {
  userId: 'user-a',
  session: sessionFixture(),
  agentProfile: CHAT_RUN_PROFILE,
  deps: {},
  repo: {},
  subagentWork: {},
  defaultCwd: '.',
} as TaskDelegationOptionsInput

test('a root chat retains the delegation host for the existing capability toggle', () => {
  const taskDelegation = buildTaskDelegationOptions(input)
  expect(taskDelegation).toBeDefined()
  expect(buildAgentsOptions({ ...input, taskDelegation })).toBeDefined()
})

test('no subsession receives a delegation host even when the setting and profile allow it', () => {
  for (const session of [
    sessionFixture({ sessionKind: 'subagent', parentSessionId: 'parent' }),
    sessionFixture({ sessionKind: 'job', parentSessionId: 'parent' }),
    sessionFixture({ parentSessionId: 'parent' }),
    sessionFixture({ rootSessionId: 'other' }),
    sessionFixture({ provenance: { kind: 'unknown-origin' } }),
  ]) {
    expect(buildTaskDelegationOptions({ ...input, session })).toBeUndefined()
  }
})

test('the delegation host uses the chat membership writer without scheduling another turn', async () => {
  let current = sessionFixture()
  const events: unknown[] = []
  const host = buildTaskDelegationOptions({
    ...input,
    session: current,
    repo: {
      getSession: async () => current,
      insertMessage: async () => {},
      updateMembership: async (_user: string, _session: string, agents: typeof current.agents) => {
        current = { ...current, agents }
        return true
      },
    } as unknown as TaskDelegationOptionsInput['repo'],
    deps: {
      listInvocableRegistryAgents: async () => [
        { agentId: 'qa', name: 'qa', description: 'Quality' },
        { agentId: 'architect', name: 'architect', description: 'Architecture' },
      ],
      streamRegistry: {
        publish: (...args: unknown[]) => {
          events.push(args)
        },
      },
    } as unknown as TaskDelegationOptionsInput['deps'],
  })!
  await host.inviteAgents(['qa'])
  expect(current.agents.map((agent) => agent.agentId)).toContain('qa')
  expect(current.id).toBe(input.session.id)
  const count = events.length
  await host.inviteAgents(['qa'])
  expect(events).toHaveLength(count)
  current = { ...current, rosterLocked: true }
  await host.inviteAgents(['qa'])
  await expect(host.inviteAgents(['architect'])).rejects.toThrow('fixed')
  await expect(host.inviteAgents(['unavailable'])).rejects.toThrow('unavailable')
  expect(current.agents.map((agent) => agent.agentId)).not.toContain('unavailable')
})
