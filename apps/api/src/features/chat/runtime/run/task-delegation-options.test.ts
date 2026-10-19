import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import { buildDelegateOptions } from './delegate-options'
import {
  buildTaskDelegationOptions,
  type TaskDelegationOptionsInput,
} from './task-delegation-options'
import { setAgentService } from '../agent-service-binding'
import { lineagePolicy } from '../../policy/session-policy'

beforeEach(() => {
  setAgentService({ resolveDelegateAgent: async () => null, wakeSession: async () => {} } as never)
})
afterEach(() => setAgentService(null as never))

const input = {
  userId: 'user-a',
  session: sessionFixture(),
  lineage: lineagePolicy(sessionFixture()),
  agentProfile: CHAT_RUN_PROFILE,
  deps: {},
  repo: {},
  subagentWork: {},
  defaultCwd: '.',
} as TaskDelegationOptionsInput

test('a root chat holds the child-session host and the delegate port built on it', () => {
  const taskDelegation = buildTaskDelegationOptions(input)
  expect(taskDelegation).toBeDefined()
  expect(buildDelegateOptions({ ...input, taskDelegation })).toBeDefined()
})

test('a profile without `delegate` gets neither the host nor the port', () => {
  const agentProfile = {
    ...CHAT_RUN_PROFILE,
    toolExposure: { ...CHAT_RUN_PROFILE.toolExposure, delegate: 'hidden' as const },
  }
  expect(buildTaskDelegationOptions({ ...input, agentProfile })).toBeUndefined()
  expect(
    buildDelegateOptions({ ...input, agentProfile, taskDelegation: undefined }),
  ).toBeUndefined()
})

test('no subsession receives a delegation host even when the setting and profile allow it', () => {
  for (const session of [
    sessionFixture({ sessionKind: 'subagent', parentSessionId: 'parent' }),
    sessionFixture({ sessionKind: 'job', parentSessionId: 'parent' }),
    sessionFixture({ parentSessionId: 'parent' }),
    sessionFixture({ rootSessionId: 'other' }),
    sessionFixture({ provenance: { kind: 'unknown-origin' } }),
  ]) {
    expect(
      buildTaskDelegationOptions({ ...input, session, lineage: lineagePolicy(session) }),
    ).toBeUndefined()
  }
})

test("the delegate port manages only the session's own children, never a deeper one", async () => {
  const messages: unknown[] = []
  setAgentService({
    resolveDelegateAgent: async () => null,
    wakeSession: async () => {},
    listDelegatedRuns: async () => [
      { sessionId: 'f1', taskName: 'check', status: 'completed', level: 1 },
      { sessionId: 'd1', taskName: 'review', status: 'completed', level: 1 },
      { sessionId: 'g1', taskName: 'deep', status: 'completed', level: 2 },
    ],
    messageSubagent: async (...args: unknown[]) => {
      messages.push(args)
      return { delivered: true, state: 'started' }
    },
  } as never)
  const port = buildDelegateOptions({
    ...input,
    taskDelegation: buildTaskDelegationOptions(input),
  })!
  expect((await port.listRuns()).map((run) => run.sessionId)).toEqual(['f1', 'd1'])
  await port.message('f1', 'also check logout', true)
  expect(messages).toEqual([['user-a', 'f1', 'also check logout', undefined, true]])
})
