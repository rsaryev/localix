import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE, resolveRunProfile } from '../../../agent-core/run-shape'
import { buildAgentOptions } from './agent-options'
import {
  buildTaskDelegationOptions,
  type TaskDelegationOptionsInput,
} from './task-delegation-options'
import { setAgentService } from '../agent-service-binding'
import { lineagePolicy } from '../../policy/session-policy'
import { noteChildStreaming } from '../../../agent-core/delegation-first-sign'
import { __resetDelegationLanes } from '../../../agent-core/delegation-lanes'
import { __resetExpectedReports } from '../../../agent-core/delegation-awaits'

beforeEach(() => {
  setAgentService({
    resolveDelegateAgent: async () => null,
    resolveDelegation: async () => ({ kind: 'unavailable' }),
    wakeSession: async () => {},
  } as never)
})
afterEach(() => {
  setAgentService(null as never)
  __resetDelegationLanes()
  __resetExpectedReports()
})

const input = {
  userId: 'user-a',
  session: sessionFixture(),
  lineage: lineagePolicy(sessionFixture()),
  agentProfile: CHAT_RUN_PROFILE,
  deps: {},
  repo: {},
  subagentWork: {},
  defaultCwd: '.',
  reportsToDelegator: false,
} as TaskDelegationOptionsInput & { reportsToDelegator: boolean }

test('a root chat holds the child-session host and the Agent ports built on it', () => {
  const taskDelegation = buildTaskDelegationOptions(input)
  expect(taskDelegation).toBeDefined()
  const ports = buildAgentOptions({ ...input, taskDelegation })
  expect(ports.Agent).toBeDefined()
  expect(ports.SendMessage?.children).toBeDefined()
  expect(ports.TaskStop?.children).toBeDefined()
})

test('a profile without `Agent` gets neither the host nor the port', () => {
  const agentProfile = {
    ...CHAT_RUN_PROFILE,
    toolExposure: { ...CHAT_RUN_PROFILE.toolExposure, Agent: 'hidden' as const },
  }
  expect(buildTaskDelegationOptions({ ...input, agentProfile })).toBeUndefined()
  expect(
    buildAgentOptions({ ...input, agentProfile, taskDelegation: undefined }).Agent,
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

test("SendMessage reaches only the session's own children, never a deeper one", async () => {
  const messages: unknown[] = []
  setAgentService({
    resolveDelegateAgent: async () => null,
    resolveDelegation: async () => ({ kind: 'unavailable' }),
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
  const { SendMessage } = buildAgentOptions({
    ...input,
    taskDelegation: buildTaskDelegationOptions(input),
  })
  const children = SendMessage!.children!
  expect((await children.listRuns()).map((run) => run.sessionId)).toEqual(['f1', 'd1'])
  await children.message('f1', 'also check logout')
  expect(messages).toEqual([['user-a', 'f1', 'also check logout']])
})

test('inside a subagent, SendMessage to "main" wakes the session that started it', async () => {
  const wakes: Record<string, unknown>[] = []
  setAgentService({
    wakeSession: async (wake: Record<string, unknown>) => void wakes.push(wake),
  } as never)
  const child = sessionFixture({
    id: 'child-1',
    title: 'Audit auth',
    sessionKind: 'subagent',
    parentSessionId: 'root',
    provenance: {
      kind: 'task-delegation',
      parentSessionId: 'root',
      toolCallId: 'call-1',
    },
  })
  const parent = sessionFixture({
    id: 'root',
    agent: { agentId: 'lead-id', name: 'lead' } as never,
  })
  const { SendMessage, Agent, TaskStop } = buildAgentOptions({
    ...input,
    session: child,
    reportsToDelegator: true,
    agentProfile: resolveRunProfile({ sessionKind: 'subagent' }, { tools: ['SendMessage'] }),
    repo: { getSession: async () => parent } as never,
    taskDelegation: undefined,
  })
  expect(Agent).toBeUndefined()
  expect(TaskStop).toBeUndefined()
  await SendMessage!.parent!.send('Which branch?', 'call-9')
  expect(wakes).toEqual([
    expect.objectContaining({
      sessionId: 'root',
      source: 'subagent',
    }),
  ])
  expect(String(wakes[0]!.content)).toContain('Which branch?')
})

test('a launch returns at the child’s first sign of life, not after a fixed wait, and siblings do not wait for each other', async () => {
  // LOCALIX-430: every launch slept 1.2 s, so three background launches were 1.2 s apart. The
  // window is only there to catch a child that dies before its first token: the first token ends it.
  const started: string[] = []
  setAgentService({
    resolveDelegateAgent: async () => null,
    resolveDelegation: async () => ({ kind: 'unavailable' }),
    wakeSession: async () => {},
    // A child that runs for as long as the test lasts.
    runJobTask: (_user: string, sessionId: string) => {
      started.push(sessionId)
      return new Promise(() => {})
    },
  } as never)
  // The window's own length is the one thing a test cannot wait for: it never elapses here.
  const delays: number[] = []
  const options = buildTaskDelegationOptions({
    ...input,
    settleDelay: (ms) => {
      delays.push(ms)
      return new Promise(() => {})
    },
  })!
  const task = { agentType: 'general-purpose', label: 'agent x', priority: 'normal' as const }
  const settled: string[] = []
  const launches = ['c1', 'c2'].map((id) =>
    options.startSubagentTask('user-a', id, 'work', task).then(() => void settled.push(id)),
  )
  await Promise.resolve()
  // Both children are running before either launch has returned.
  expect(started).toEqual(['c1', 'c2'])
  expect(settled).toEqual([])

  noteChildStreaming('c2')
  await launches[1]
  expect(settled).toEqual(['c2'])
  noteChildStreaming('c1')
  await launches[0]
  expect(settled).toEqual(['c2', 'c1'])
  // The window is still bounded: it is the wait that was there before, at most.
  expect(delays).toEqual([1_200, 1_200])
})

test('a launch whose child never shows a sign of life returns when the window closes', async () => {
  setAgentService({
    resolveDelegateAgent: async () => null,
    resolveDelegation: async () => ({ kind: 'unavailable' }),
    wakeSession: async () => {},
    runJobTask: () => new Promise(() => {}),
  } as never)
  let elapse!: () => void
  const options = buildTaskDelegationOptions({
    ...input,
    settleDelay: () => new Promise<void>((resolve) => (elapse = resolve)),
  })!
  let returned = false
  const launch = options
    .startSubagentTask('user-a', 'slow', 'work', {
      agentType: 'general-purpose',
      label: 'agent x',
      priority: 'normal',
    })
    .then(() => void (returned = true))
  await Promise.resolve()
  expect(returned).toBe(false)
  elapse()
  await launch
  expect(returned).toBe(true)
})
