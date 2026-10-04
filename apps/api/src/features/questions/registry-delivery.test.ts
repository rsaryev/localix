import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import { recordDecidedDelivery } from '../chat/runtime/delivery-receipts'
import { answerDeliveryKey } from './contracts'
import { createQuestionRegistry } from './registry'
import { createQuestionRepository } from './repository'

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

const owner = { userId: 'u1', sessionId: 's1' }
const registry = () => createQuestionRegistry({ repo: createQuestionRepository(db) })
const ask = (questions: ReturnType<typeof registry>, id: string, text: string, agentId = 'lead') =>
  questions.ask({
    owner,
    agentId,
    toolCallId: `call-${text}`,
    questions: [{ id, question: text, options: [{ label: 'A' }] }],
  })
const answer = (id: string) => [{ id, question: '', selectedOptions: ['A'] }]

describe('what counts as the same question', () => {
  test('a reused generic id with a different question replaces nothing', async () => {
    const questions = registry()
    await ask(questions, 'choice', 'Which database?')
    const second = await ask(questions, 'choice', 'Which colour?')
    expect(second.superseded).toEqual([])
    expect(questions.list(owner)).toHaveLength(2)
  })

  test('the same id and the same question is a re-ask, and replaces the open one', async () => {
    const questions = registry()
    await ask(questions, 'db', 'Which database?')
    expect((await ask(questions, 'db', ' Which database? ')).superseded).toEqual(['q-1'])
  })
})

describe('skips the agent has not been told of', () => {
  test('are taken once, by the asking agent only', async () => {
    const questions = registry()
    await ask(questions, 'db', 'Which database?', 'lead')
    await questions.skip(owner, 'q-1')
    expect(questions.takeSkipped(owner, 'qa')).toEqual([])
    expect(questions.takeSkipped(owner, 'lead').map((r) => r.displayId)).toEqual(['q-1'])
    // Told once: the next prompt does not repeat it.
    expect(questions.takeSkipped(owner, 'lead')).toEqual([])
  })
})

describe('answers whose wake never landed', () => {
  test('an answer without a receipt is found again; one with a receipt is done', async () => {
    const questions = registry()
    await ask(questions, 'db', 'Which database?')
    await ask(questions, 'ui', 'Which UI kit?')
    const first = await questions.answer(owner, 'q-1', answer('db'))
    await questions.answer(owner, 'q-2', answer('ui'))
    // q-1's wake was admitted: its receipt is what the wake queue writes with the row.
    if (!first.ok) throw new Error('q-1 should have closed')
    await recordDecidedDelivery(db, {
      deliveryKey: answerDeliveryKey(first.record),
      userId: 'u1',
      sessionId: 's1',
    })
    const stranded = await questions.undeliveredAnswers('1970-01-01T00:00:00.000Z')
    expect(stranded.map((record) => record.displayId)).toEqual(['q-2'])
  })

  test('nothing older than the receipt horizon is re-sent', async () => {
    const questions = registry()
    await ask(questions, 'db', 'Which database?')
    await questions.answer(owner, 'q-1', answer('db'))
    expect(await questions.undeliveredAnswers('2999-01-01T00:00:00.000Z')).toEqual([])
  })
})
