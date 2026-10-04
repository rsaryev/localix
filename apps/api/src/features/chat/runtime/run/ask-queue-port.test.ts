import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import type { AppDatabase } from '../../../../db/types'
import { createQuestionRegistry } from '../../../questions/registry'
import { createQuestionRepository } from '../../../questions/repository'
import { createAskQueuePort } from './ask-queue-port'

let db: Kysely<AppDatabase>
beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 's1', user_id: 'u1', title: 's1' })
    .execute()
})
afterEach(() => destroyDatabase(db))

const questions = [
  { id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
]

/** One transcript row holding one earlier `ask` call, as the run persisted it. */
function repoWith(item: Record<string, unknown> | null, from = 'agent:lead') {
  return {
    findActiveBranchToolCallMessage: async () =>
      item
        ? ({ id: 'm1', payload: { id: 'm1', role: 'assistant', from, items: [item] } } as never)
        : null,
  }
}

function setup(agentId = 'lead', item: Record<string, unknown> | null = null, from?: string) {
  const registry = createQuestionRegistry({ repo: createQuestionRepository(db) })
  const port = createAskQueuePort({
    questions: registry,
    repo: repoWith(item, from),
    userId: 'u1',
    sessionId: 's1',
    agentId,
  })
  return { registry, port }
}

describe('recall by q-N', () => {
  test('an open question comes back with its id, so it is not queued twice', async () => {
    const { port } = setup()
    const { questionId } = await port.queue({ toolCallId: 'c1', questions })
    expect(await port.recall(questionId)).toEqual({ questions, openQuestionId: 'q-1' })
  })

  test('a closed one comes back too — from its row — without an open id', async () => {
    const { port, registry } = setup()
    await port.queue({ toolCallId: 'c1', questions })
    await registry.skip({ userId: 'u1', sessionId: 's1' }, 'q-1')
    expect(await port.recall('q-1')).toEqual({ questions })
  })

  test("a colleague's question is theirs: it can be neither recalled nor closed", async () => {
    const lead = setup('lead')
    await lead.port.queue({ toolCallId: 'c1', questions })
    const qa = createAskQueuePort({
      questions: lead.registry,
      repo: repoWith(null),
      userId: 'u1',
      sessionId: 's1',
      agentId: 'qa',
    })
    expect(await qa.recall('q-1')).toMatchObject({ refused: expect.stringContaining('another') })
  })

  test('supersede closes it, so the strip stops offering it', async () => {
    const { port, registry } = setup()
    await port.queue({ toolCallId: 'c1', questions })
    await port.supersede('q-1')
    expect(registry.list({ userId: 'u1', sessionId: 's1' })).toEqual([])
  })

  test('an unknown id is refused with how to do it right', async () => {
    const { port } = setup()
    expect(await port.recall('q-42')).toMatchObject({ refused: expect.stringContaining('q-N') })
  })
})

describe('recall by an earlier ask call id', () => {
  const askItem = (extra: Record<string, unknown> = {}) => ({
    id: 'i1',
    type: 'tool_call',
    toolCallId: 'call_1',
    name: 'ask',
    status: 'failed',
    activeVerb: '',
    input: { questions },
    ...extra,
  })

  test('an expired blocking ask returns its written-out questions', async () => {
    const { port } = setup('lead', askItem())
    expect(await port.recall('call_1')).toEqual({ questions })
  })

  test('a call that queued its question recalls THAT question — still open, by its id', async () => {
    const { port } = setup()
    await port.queue({ toolCallId: 'call_1', questions })
    const withQueued = createAskQueuePort({
      questions: setup().registry,
      repo: repoWith(askItem({ output: { queued: { questionId: 'q-1', status: 'pending' } } })),
      userId: 'u1',
      sessionId: 's1',
      agentId: 'lead',
    })
    // A fresh registry over the same table: what a later run of the same session sees.
    expect(await withQueued.recall('call_1')).toMatchObject({ questions })
  })

  test('only an ask call can be re-asked, and only by the participant that made it', async () => {
    expect(await setup('lead', askItem({ name: 'bash' })).port.recall('call_1')).toMatchObject({
      refused: expect.stringContaining('not an ask'),
    })
    expect(await setup('lead', askItem(), 'agent:qa').port.recall('call_1')).toMatchObject({
      refused: expect.stringContaining('another'),
    })
  })
})
