import { afterEach, describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createQuestionRegistry } from '../../questions/registry'
import { createQuestionRepository } from '../../questions/repository'
import { createMemoryWorkRepository } from '../../work/memory-repository'
import { createWorkRegistry } from '../../work/registry'
import type { InboxEntry } from '../contracts'
import { createNotificationJournal } from '../journal'
import { settleStaleRequests, startAgentNotifications } from '.'
import type { SessionFacts } from './facts'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

const U = 'local-user'
const chat: SessionFacts = {
  id: 'S1',
  projectId: 'P1',
  title: 'Deploy',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'root' },
}
const owner = { userId: U, sessionId: 'S1' }

async function setup() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 'S1', user_id: U, title: 'Deploy' })
    .execute()
  const journal = createNotificationJournal({ db })
  const questions = createQuestionRegistry({ repo: createQuestionRepository(db) })
  const producers = await startAgentNotifications({
    db,
    journal,
    lookupSession: async (_user, id) => (id === chat.id ? chat : null),
    defaultUserId: U,
    work: createWorkRegistry({ repo: createMemoryWorkRepository() }),
    questions,
  })
  const inbox = async (): Promise<InboxEntry[]> => {
    await producers.idle()
    await journal.flush()
    return (await journal.sync(U, 0)).changes.flatMap((change) =>
      'entry' in change ? [change.entry] : [],
    )
  }
  const ask = () =>
    questions.ask({
      owner,
      agentId: 'lead',
      toolCallId: 'call-1',
      questions: [{ id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }] }],
    })
  return { db, journal, questions, inbox, ask }
}

describe('queued questions in the notification journal', () => {
  it('asking raises a human-input row saying what was asked, filed under the chat', async () => {
    const { inbox, ask } = await setup()
    const { record } = await ask()
    expect((await inbox())[0]).toMatchObject({
      key: `question:${record.id}`,
      topic: 'hitl.required',
      category: 'human-input',
      severity: 'info',
      body: 'Which database?',
      origin: { kind: 'resource', resourceKind: 'question', resourceId: 'q-1', sessionId: 'S1' },
    })
  })

  it('an answer settles it — through the lane, even right after the raise', async () => {
    const { inbox, ask, questions } = await setup()
    await ask()
    await questions.answer(owner, 'q-1', [
      { id: 'db', question: 'Which database?', selectedOptions: ['Postgres'] },
    ])
    expect((await inbox())[0]).toMatchObject({ state: 'settled', settleReason: 'answered' })
  })

  it('a skip settles it as dismissed, and a re-ask as superseded', async () => {
    const { inbox, ask, questions } = await setup()
    await ask()
    await ask() // the same question again replaces q-1
    await questions.skip(owner, 'q-2')
    const rows = await inbox()
    expect(
      rows
        .map((row) => row.settleReason)
        .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
    ).toEqual(['dismissed', 'superseded'])
  })

  it('a restart leaves an open question’s row standing — the question survived it too', async () => {
    const { db, journal, inbox, ask } = await setup()
    await ask()
    await inbox()
    await settleStaleRequests(db, journal)
    expect((await inbox())[0]).toMatchObject({ state: expect.not.stringMatching('settled') })
  })
})
