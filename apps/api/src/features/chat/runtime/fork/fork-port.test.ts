import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../../../db'
import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import { captureForkSeed } from '../../../agent-core/fork-seed'
import { FORK_CALL_RESULT } from '../../../agent-core/tools/delegate-fork'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import type { PersistedMessage } from '../../contracts'
import { createModelContextRepository } from '../../model-context-repository'
import { createChatRepository } from '../../repository'
import { createForkPort, type ForkLiveRun } from './fork-port'

let db: ReturnType<typeof createDatabase>
let repo: ReturnType<typeof createChatRepository>

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  repo = createChatRepository(db)
})
afterEach(async () => {
  await destroyDatabase(db)
})

const AT = '2026-07-31T00:00:00.000Z'
const message = (
  id: string,
  sessionId: string,
  payload: Record<string, unknown>,
): PersistedMessage =>
  ({
    id,
    sessionId,
    userId: 'u',
    payload: { id, from: DEFAULT_AGENT_PARTICIPANT, ...payload },
    createdAt: AT,
    updatedAt: AT,
  }) as never
const text = (id: string, role: 'user' | 'assistant') =>
  message(id, 'parent', {
    role,
    content: id,
    ...(role === 'user' ? { from: USER_PARTICIPANT } : {}),
  })

const items = [
  {
    type: 'tool_call',
    id: 'i1',
    toolCallId: 'r1',
    name: 'read',
    status: 'completed',
    turnIndex: 0,
    input: {},
    resultText: 'done',
  },
  {
    type: 'tool_call',
    id: 'i2',
    toolCallId: 'd1',
    name: 'delegate',
    status: 'running',
    turnIndex: 1,
    input: {},
  },
]

async function parent() {
  const session = sessionFixture({
    id: 'parent',
    userId: 'u',
    agents: routedParticipants(),
    rootSessionId: 'parent',
  })
  await repo.insertSession(session)
  await repo.insertMessage(text('u1', 'user'))
  await repo.insertMessage(text('a1', 'assistant'))
  await repo.insertMessage(text('u2', 'user'))
  await repo.insertMessage(message('a2', 'parent', { role: 'assistant', content: '', items }))
  return session
}

const live = (): ForkLiveRun => ({
  recorded: async () => {},
  currentRowId: () => 'a2',
  currentPayload: () =>
    ({
      id: 'a2',
      role: 'assistant',
      from: DEFAULT_AGENT_PARTICIPANT,
      content: 'the parent’s words so far',
      items,
    }) as never,
  route: { providerConnectionId: 'conn', modelId: 'model-x', reasoningEffort: 'high' },
  captureSeed: () =>
    captureForkSeed({
      systemPrompt: 'SYSTEM',
      tools: [],
      cacheSessionId: 'parent',
      toolNames: ['read'],
      profile: resolveRunProfile({ sessionKind: 'chat' }),
    }),
})

describe('the fork port', () => {
  test('captures the point the call was made at: the row before the row in flight, the route', async () => {
    const session = await parent()
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: createModelContextRepository(db),
      live,
      now: () => AT,
      newId: () => 'copy',
    })
    const capture = await port.capture('d1')
    expect(capture.baseMessageId).toBe('u2')
    expect(capture.snapshotMessageId).toBe('copy')
    expect(capture.route).toEqual({
      providerConnectionId: 'conn',
      modelId: 'model-x',
      reasoningEffort: 'high',
    })
  })

  test('waits for the run to record the call before it reads the row', async () => {
    const session = await parent()
    let recorded = false
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: createModelContextRepository(db),
      live: () => ({
        ...live(),
        recorded: async () => {
          await Promise.resolve()
          recorded = true
        },
        // The row has the call only once it is recorded.
        currentPayload: () =>
          ({
            id: 'a2',
            role: 'assistant',
            from: DEFAULT_AGENT_PARTICIPANT,
            content: '',
            items: recorded ? items : [],
          }) as never,
      }),
      now: () => AT,
      newId: () => 'copy',
    })
    expect((await port.capture('d1')).snapshotMessageId).toBe('copy')
  })

  test('is a call outside a run that is streaming an error, not a guess', async () => {
    const session = await parent()
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: createModelContextRepository(db),
      live: () => undefined,
      now: () => AT,
    })
    await expect(port.capture('d1')).rejects.toThrow(/streaming/)
  })

  test('persists the child’s own first row, the parent’s context for it, and the seed', async () => {
    const session = await parent()
    const models = createModelContextRepository(db)
    await models.write({
      sessionId: 'parent',
      messageId: 'a2',
      turnContext: { content: 'CONTEXT', full: true } as never,
      now: AT,
    })
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: models,
      live,
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
        agents: routedParticipants(),
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

    const history = await repo.listMessages('u', 'fork')
    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2', 'copy'])
    const copy = history.at(-1)!
    expect(copy.sessionId).toBe('fork')
    const copied = copy.payload.items as Array<{ toolCallId: string; resultText?: string }>
    expect(copied.find((item) => item.toolCallId === 'd1')?.resultText).toBe(FORK_CALL_RESULT)
    expect((await models.list('fork', ['copy'])).get('copy')?.turnContext).toMatchObject({
      content: 'CONTEXT',
    })
    const seed = await repo.getForkSeed('u', 'fork')
    expect(seed?.systemPrompt).toBe('SYSTEM')
    expect(seed?.cacheSessionId).toBe('parent')
    expect(seed?.profile.shape).toBeDefined()
  })

  test('the fork’s history does not move when the parent goes on writing', async () => {
    const session = await parent()
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: createModelContextRepository(db),
      live,
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
        agents: routedParticipants(),
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
    const before = await repo.listMessages('u', 'fork')
    await repo.insertMessage(text('u3', 'user'))
    await repo.updateMessage('u', 'parent', 'a2', { content: 'it finished later' } as never, AT)
    expect(await repo.listMessages('u', 'fork')).toEqual(before)
  })

  test('the fork has said nothing until it answers: its report is its own reply, never the copy', async () => {
    const session = await parent()
    const port = createForkPort({
      userId: 'u',
      parent: session,
      repo,
      modelContext: createModelContextRepository(db),
      live,
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
        agents: routedParticipants(),
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
    await repo.insertMessage(
      message('directive', 'fork', { role: 'user', from: USER_PARTICIPANT, content: 'Do it.' }),
    )
    // What a delegator is handed back is the latest reply with words in it (`finalAssistantText`).
    expect(await repo.getLatestAutonomousAssistantContentMessage('u', 'fork')).toBeNull()

    await repo.insertMessage(
      message('answer', 'fork', { role: 'assistant', content: 'Done: 3 files.' }),
    )
    expect(
      (await repo.getLatestAutonomousAssistantContentMessage('u', 'fork'))?.payload.content,
    ).toBe('Done: 3 files.')
  })
})
