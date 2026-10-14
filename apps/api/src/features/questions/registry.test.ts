import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import type { AskToolQuestion } from '../agent-core/tools/hitl/ask'
import type { QuestionRecord } from './contracts'
import { createQuestionRegistry } from './registry'
import { createQuestionRepository } from './repository'

let db: Kysely<AppDatabase>

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  for (const [id, user] of [
    ['sA', 'u1'],
    ['sB', 'u1'],
    ['sC', 'u2'],
  ])
    await db
      .insertInto('agent_sessions')
      .values({ project_id: 'PRJ-test', id, user_id: user, title: id })
      .execute()
})
afterEach(() => destroyDatabase(db))

const registry = () => createQuestionRegistry({ repo: createQuestionRepository(db) })
const question = (id: string, text = `Which ${id}?`): AskToolQuestion => ({
  id,
  question: text,
  options: [{ label: 'A' }, { label: 'B' }],
})
/** A valid answer to `question(id)`: its first option. */
const pick = (id: string) => [{ id, question: `Which ${id}?`, selectedOptions: ['A'] }]
const ask = (
  questions: ReturnType<typeof registry>,
  sessionId: string,
  ids: string[],
  agentId = 'lead',
  userId = 'u1',
) =>
  questions.ask({
    owner: { userId, sessionId },
    agentId,
    toolCallId: `call-${sessionId}-${ids.join('-')}-${agentId}`,
    questions: ids.map((id) => question(id)),
  })

describe('asking', () => {
  test('mints q-N per session, monotonic and never reused', async () => {
    const questions = registry()
    expect((await ask(questions, 'sA', ['db'])).record.displayId).toBe('q-1')
    expect((await ask(questions, 'sA', ['ui'])).record.displayId).toBe('q-2')
    expect((await ask(questions, 'sB', ['db'])).record.displayId).toBe('q-1')
    await questions.answer({ userId: 'u1', sessionId: 'sA' }, 'q-2', pick('ui'))
    // q-2 is closed, and the next question still does not reuse its number.
    expect((await ask(questions, 'sA', ['api'])).record.displayId).toBe('q-3')
  })

  test('the row is written before the call returns — the id the agent holds is durable', async () => {
    const questions = registry()
    const { record } = await ask(questions, 'sA', ['db'])
    const row = await db
      .selectFrom('agent_questions')
      .selectAll()
      .where('id', '=', record.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('pending')
    expect(JSON.parse(row.questions_json)).toEqual([question('db')])
  })

  test('re-asking the same question supersedes the open one instead of stacking it', async () => {
    const questions = registry()
    const resolved: QuestionRecord[] = []
    questions.onResolved((record) => resolved.push(record))
    await ask(questions, 'sA', ['db'])
    const again = await ask(questions, 'sA', ['db'])
    expect(again.superseded).toEqual(['q-1'])
    expect(questions.list({ userId: 'u1', sessionId: 'sA' }).map((q) => q.displayId)).toEqual([
      'q-2',
    ])
    expect(resolved.map((r) => [r.displayId, r.status])).toEqual([['q-1', 'superseded']])
  })

  test("a colleague's question with the same ids is not superseded", async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'], 'lead')
    const theirs = await ask(questions, 'sA', ['db'], 'qa')
    expect(theirs.superseded).toEqual([])
    expect(questions.list({ userId: 'u1', sessionId: 'sA' })).toHaveLength(2)
  })
})

describe('one owner filter', () => {
  test("a session sees its own open questions, never another session's or user's", async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'])
    await ask(questions, 'sB', ['db'])
    await ask(questions, 'sC', ['db'], 'lead', 'u2')
    expect(questions.list({ userId: 'u1', sessionId: 'sA' })).toHaveLength(1)
    expect(questions.list({ userId: 'u2', sessionId: 'sA' })).toEqual([])
    // Answering by a guessed id from another owner reaches nothing.
    expect(await questions.answer({ userId: 'u2', sessionId: 'sA' }, 'q-1', [])).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('closing', () => {
  test('an answer closes it once, records the answers, and announces the close', async () => {
    const questions = registry()
    const resolved: QuestionRecord[] = []
    questions.onResolved((record) => resolved.push(record))
    await ask(questions, 'sA', ['db'])
    const answers = [{ id: 'db', question: 'Which db?', selectedOptions: ['A'] }]
    const result = await questions.answer({ userId: 'u1', sessionId: 'sA' }, 'q-1', answers)
    expect(result.ok).toBe(true)
    expect(questions.list({ userId: 'u1', sessionId: 'sA' })).toEqual([])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ status: 'answered', answers })
    const row = await db.selectFrom('agent_questions').selectAll().executeTakeFirstOrThrow()
    expect(row.status).toBe('answered')
    expect(JSON.parse(row.answers_json!)).toEqual(answers)
  })

  test('two tabs answering at once deliver ONE answer — the row decides', async () => {
    const repo = createQuestionRepository(db)
    // Two processes' worth of index over one table: each believes q-1 is open.
    const first = createQuestionRegistry({ repo })
    await ask(first, 'sA', ['db'])
    const second = createQuestionRegistry({ repo })
    await second.hydrate()
    const resolved: QuestionRecord[] = []
    first.onResolved((record) => resolved.push(record))
    second.onResolved((record) => resolved.push(record))

    const owner = { userId: 'u1', sessionId: 'sA' }
    const [a, b] = await Promise.all([
      first.answer(owner, 'q-1', pick('db')),
      second.answer(owner, 'q-1', pick('db')),
    ])
    expect([a.ok, b.ok].sort((left, right) => Number(left) - Number(right))).toEqual([false, true])
    expect(resolved).toHaveLength(1)
  })

  test('what is stored is held to the question’s own options, as a live ask holds it', async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'])
    const result = await questions.answer({ userId: 'u1', sessionId: 'sA' }, 'q-1', [
      { id: 'db', question: 'forged text', selectedOptions: ['B', 'A', 'Oracle'] },
      { id: 'ghost', question: 'never asked', selectedOptions: ['A'] },
    ])
    expect(result).toMatchObject({
      ok: true,
      record: { answers: [{ id: 'db', question: 'Which db?', selectedOptions: ['B'] }] },
    })
  })

  test('a skip closes it without answers', async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'])
    const result = await questions.skip({ userId: 'u1', sessionId: 'sA' }, 'q-1')
    expect(result).toMatchObject({ ok: true, record: { status: 'skipped', answers: null } })
  })
})

describe('across a restart', () => {
  test('open questions are still open, and spent ids stay spent', async () => {
    const before = registry()
    await ask(before, 'sA', ['db'])
    await ask(before, 'sA', ['ui'])
    await before.skip({ userId: 'u1', sessionId: 'sA' }, 'q-2')

    const after = registry()
    await after.hydrate()
    expect(after.list({ userId: 'u1', sessionId: 'sA' }).map((q) => q.displayId)).toEqual(['q-1'])
    expect((await ask(after, 'sA', ['api'])).record.displayId).toBe('q-3')
    // And the reloaded question can be answered like any other.
    expect((await after.answer({ userId: 'u1', sessionId: 'sA' }, 'q-1', pick('db'))).ok).toBe(true)
  })

  test('an answer naming none of the questions asked is refused, and the question stays open', async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'])
    const owner = { userId: 'u1', sessionId: 'sA' }
    expect(
      await questions.answer(owner, 'q-1', [
        { id: 'ghost', question: 'never asked', selectedOptions: ['A'] },
      ]),
    ).toEqual({ ok: false, reason: 'empty' })
    expect(questions.list(owner)).toHaveLength(1)
  })

  test('a deleted session is forgotten by the index', async () => {
    const questions = registry()
    await ask(questions, 'sA', ['db'])
    questions.forgetSession('sA')
    expect(questions.list({ userId: 'u1', sessionId: 'sA' })).toEqual([])
  })
})
