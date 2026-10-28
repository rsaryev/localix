import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toModelMessages } from '@localixai/agent/agents/chat'

import { DEFAULT_AGENT_AUTHOR, USER_AUTHOR } from '../../../../db'
import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { routedAgent, sessionFixture } from '../../../../testing/session-fixture'
import { captureForkSeed } from '../../../agent-core/fork-seed'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { FORK_CALL_RESULT } from '../../../agent-core/tools/agent/agent-fork'
import type { PersistedMessage } from '../../contracts'
import { createModelContextRepository } from '../../model-context-repository'
import { createChatRepository } from '../../repository'
import { resolveContextBudgetFrame } from '../context-budget'
import { createChatHistoryRun } from '../history/chat-strategy'
import { bareFrame, freshLane, TEST_IDENTITY } from '../history/testing/test-fixtures'
import { checkpointAtTokens } from '../model-view/checkpoint-policy'
import { loadModelView } from '../model-view/view'
import { budgetDepth, loadForkRun } from './fork-run'
import { createForkPort, type ForkLiveRun } from './fork-port'

/**
 * THE ORACLE OF A FORK: what the fork's first request carries is what the parent's last request
 * carried, byte for byte, and then the call, its answer and the directive. The provider's cache
 * reads a prefix, so anything that differs before the end of the parent's request is a cache
 * write instead of a read, for the whole conversation.
 *
 * Real database, real model view, real history strategy; only the provider is absent.
 */
let db: ReturnType<typeof createDatabase>
let repo: ReturnType<typeof createChatRepository>
let models: ReturnType<typeof createModelContextRepository>

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  repo = createChatRepository(db)
  models = createModelContextRepository(db)
})
afterEach(async () => {
  await destroyDatabase(db)
})

const AT = '2026-07-31T00:00:00.000Z'
const VIEWER = DEFAULT_AGENT_AUTHOR
const TOOLS = ['Read', 'Bash', 'delegate']
const FRAME = resolveContextBudgetFrame({ contextWindow: 200_000, fixedOverheadTokens: 5_000 })

const row = (id: string, sessionId: string, payload: Record<string, unknown>): PersistedMessage =>
  ({
    id,
    sessionId,
    userId: 'u',
    payload: { id, ...payload },
    createdAt: AT,
    updatedAt: AT,
  }) as never

const userRow = (id: string, sessionId: string, content: string) =>
  row(id, sessionId, { role: 'user', from: USER_AUTHOR, content })

const readCall = (id: string, turnIndex: number) => ({
  type: 'tool_call',
  id: `item-${id}`,
  toolCallId: id,
  name: 'Read',
  status: 'completed',
  turnIndex,
  input: { path: `/repo/${id}.ts` },
  resultText: `contents of ${id}`,
})

const bytesOf = (wire: readonly unknown[]) =>
  wire.map((m) =>
    JSON.stringify(m, (k, v) => (k === 'timestamp' || k === 'cacheAnchor' ? undefined : v)),
  )

const SECTIONS = [{ key: 'env', scope: 'state' as const, text: 'Working in /repo.' }]

async function setup(measured?: number, checkpointAtCall = false, checkpointEarlier = false) {
  const session = sessionFixture({
    id: 'parent',
    userId: 'u',
    agent: routedAgent(),
    rootSessionId: 'parent',
  })
  await repo.insertSession(session)
  const history: PersistedMessage[] = []
  const add = async (message: PersistedMessage) => {
    await repo.insertMessage(message)
    history.push(message)
  }

  // One ordinary earlier turn, with the runtime context it was sent.
  await add(userRow('u1', 'parent', 'first question'))
  const first = await materialize('parent', history, 'u1', 'a1', {
    viewer: VIEWER,
    ...(checkpointEarlier ? { forced: 'threshold' as const } : {}),
  })
  if (checkpointEarlier) expect(first.checkpoint).toBeDefined()
  await add(
    row('a1', 'parent', {
      role: 'assistant',
      from: VIEWER,
      content: 'first answer',
      items: [readCall('r0', 0)],
      ...(measured ? { usage: { contextTokens: measured } } : {}),
    }),
  )
  await models.write({
    sessionId: 'parent',
    messageId: 'a1',
    ...(first.checkpoint ? { checkpoint: first.checkpoint } : {}),
    turnContext: first.turnContext!,
    now: AT,
  })

  // The turn that calls the fork: u2 starts it, a2 is in flight.
  await add(userRow('u2', 'parent', 'second question'))
  const start = await materialize('parent', history, 'u2', 'a2', {
    viewer: VIEWER,
    ...(checkpointAtCall ? { forced: 'threshold' as const } : {}),
  })
  if (checkpointAtCall) expect(start.checkpoint).toBeDefined()
  const inFlight = {
    id: 'a2',
    role: 'assistant',
    from: VIEWER,
    content: '',
    items: [
      readCall('r1', 0),
      {
        type: 'tool_call',
        id: 'item-d1',
        toolCallId: 'd1',
        name: 'delegate',
        status: 'running',
        turnIndex: 1,
        input: { task: 'x' },
      },
    ],
  }
  await add(row('a2', 'parent', inFlight))
  await models.write({
    sessionId: 'parent',
    messageId: 'a2',
    ...(start.checkpoint ? { checkpoint: start.checkpoint } : {}),
    turnContext: start.turnContext!,
    now: AT,
  })
  // The request that produced the call: the run's first request plus the step before the call.
  const parentWire = [
    ...start.wire,
    ...toModelMessages([{ ...inFlight, items: [readCall('r1', 0)] }] as never),
  ]
  return { session, history, parentWire, inFlight }
}

async function materialize(
  sessionId: string,
  history: readonly PersistedMessage[],
  triggerId: string,
  assistantId: string,
  options: {
    viewer: string
    fork?: { toolCallId: string; first: boolean }
    depth?: number
    forced?: 'threshold'
  },
) {
  const view = await loadModelView(models, {
    sessionId,
    viewer: options.viewer,
    historyMessages: history,
    currentMessageId: assistantId,
    contextWindow: 200_000,
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
    ...(options.forced ? { forced: options.forced } : {}),
  })
  const run = createChatHistoryRun({
    sessionId,
    frame: FRAME,
    identity: TEST_IDENTITY,
    availableTools: new Set(TOOLS),
    view,
    media: {},
    state: freshLane(),
    recoveryToolAvailable: true,
    ...(options.fork ? { fork: options.fork } : {}),
  })
  const frame = { ...bareFrame(history, triggerId, SECTIONS, assistantId), sessionId }
  return run.materialize(frame, new AbortController().signal)
}

async function fork(setupResult: Awaited<ReturnType<typeof setup>>) {
  const live: ForkLiveRun = {
    recorded: async () => {},
    currentRowId: () => 'a2',
    currentPayload: () => setupResult.inFlight as never,
    route: { providerConnectionId: null, modelId: 'm' },
    captureSeed: () =>
      captureForkSeed({
        systemPrompt: 'SYSTEM',
        tools: [],
        cacheSessionId: 'parent',
        toolNames: TOOLS,
        profile: resolveRunProfile({ sessionKind: 'chat' }),
      }),
  }
  const port = createForkPort({
    userId: 'u',
    parent: setupResult.session,
    repo,
    modelContext: models,
    live: () => live,
    now: () => AT,
    newId: () => 'copy',
  })
  const capture = await port.capture('d1')
  await repo.insertSession(
    sessionFixture({
      id: 'fork',
      userId: 'u',
      seq: 2,
      sessionKind: 'subagent',
      parentSessionId: 'parent',
      rootSessionId: 'parent',
      agent: routedAgent(),
      provenance: {
        kind: 'task-delegation',
        parentSessionId: 'parent',
        toolCallId: 'd1',
        fork: {
          baseMessageId: capture.baseMessageId,
          snapshotMessageId: capture.snapshotMessageId,
        },
      },
    }),
  )
  await port.persist('fork', capture)
  await repo.insertMessage(userRow('directive', 'fork', 'Do the directive.'))
}

/** The fork's first request, from the inputs a run takes them from (`stages/admit.ts`, `view.ts`). */
const forkWire = async () => {
  const history = await repo.listMessages('u', 'fork')
  const session = (await repo.getSession('u', 'fork'))!
  const run = (await loadForkRun(repo, 'u', session, history, 'child-run'))!
  return materialize('fork', history, 'directive', 'child-run', {
    viewer: VIEWER,
    fork: { toolCallId: run.toolCallId, first: run.first },
    depth: budgetDepth(session, run),
  })
}

describe('the first request of a fork', () => {
  test('begins with the parent’s last request, byte for byte', async () => {
    const parent = await setup()
    await fork(parent)
    const child = await forkWire()
    const prefix = bytesOf(parent.parentWire)
    expect(prefix.length).toBeGreaterThan(5)
    expect(bytesOf(child.wire).slice(0, prefix.length)).toEqual(prefix)
  })

  test('then carries the call, every call of its step answered, and the directive, and nothing else', async () => {
    const parent = await setup()
    await fork(parent)
    const { wire } = await forkWire()
    const tail = wire.slice(parent.parentWire.length) as unknown as Array<Record<string, unknown>>
    expect(tail.map((message) => message.role)).toEqual(['assistant', 'tool', 'user'])
    const answers = (tail[1] as { results: Array<{ toolCallId: string; content: string }> }).results
    expect(answers.map((r) => [r.toolCallId, r.content])).toEqual([['d1', FORK_CALL_RESULT]])
    expect(JSON.stringify(tail.at(-1))).toContain('Do the directive.')
  })

  test('marks the cache anchor on the last message the parent had sent', async () => {
    const parent = await setup()
    await fork(parent)
    const { wire } = await forkWire()
    const anchored = wire.flatMap((message, index) => (message.cacheAnchor ? [index] : []))
    expect(anchored).toEqual([parent.parentWire.length - 1])
  })

  test('is the same after the parent writes more, regenerates or answers its call', async () => {
    const parent = await setup()
    await fork(parent)
    const before = bytesOf((await forkWire()).wire)

    await repo.insertMessage(userRow('u3', 'parent', 'a later question'))
    await repo.insertMessage(
      row('a3', 'parent', { role: 'assistant', from: VIEWER, content: 'later answer' }),
    )
    await models.write({
      sessionId: 'parent',
      messageId: 'a3',
      turnContext: { content: 'LATER', full: true } as never,
      now: AT,
    })
    await repo.updateMessage('u', 'parent', 'a2', { content: 'finished' } as never, AT)

    expect(bytesOf((await forkWire()).wire)).toEqual(before)
  })
})

describe('a fork of a long conversation', () => {
  // A delegated child budgets against at most 128k, its parent against the whole window. A fork is
  // its parent, so it budgets as its parent: measured against the child's mark, the parent's last
  // request would be "due" and the fork would be shown a re-planned view, not the cached one.
  test('keeps the parent’s view when the parent is past a child’s checkpoint mark but not its own', async () => {
    const childMark = checkpointAtTokens(
      resolveContextBudgetFrame({ contextWindow: 200_000, depth: 1 }),
    )
    const ownMark = checkpointAtTokens(resolveContextBudgetFrame({ contextWindow: 200_000 }))
    expect(childMark).toBeLessThan(ownMark)
    const parent = await setup(childMark + 1)
    await fork(parent)
    const child = await forkWire()
    expect(child.checkpoint).toBeUndefined()
    expect(bytesOf(child.wire).slice(0, parent.parentWire.length)).toEqual(
      bytesOf(parent.parentWire),
    )
  })
})

describe('a fork of a conversation with a checkpoint in force', () => {
  test('reads the view the parent was sent when the checkpoint was taken by the turn that forks', async () => {
    const parent = await setup(undefined, true)
    await fork(parent)
    const child = await forkWire()
    expect(child.checkpoint).toBeUndefined()
    expect(bytesOf(child.wire).slice(0, parent.parentWire.length)).toEqual(
      bytesOf(parent.parentWire),
    )
  })

  test('reads a checkpoint an earlier turn of the parent took, found under the parent’s session', async () => {
    const parent = await setup(undefined, false, true)
    await fork(parent)
    const child = await forkWire()
    expect(child.checkpoint).toBeUndefined()
    expect(bytesOf(child.wire).slice(0, parent.parentWire.length)).toEqual(
      bytesOf(parent.parentWire),
    )
  })
})
