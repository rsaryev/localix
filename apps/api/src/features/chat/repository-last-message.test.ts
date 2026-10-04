import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { agentParticipant, DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import type { PersistedMessage } from './contracts'
import { createChatRepository, type SessionRecord } from './repository'

const tempDir = join(process.cwd(), 'tmp', 'chat-repository-last-message-tests')
const TIMESTAMP = '2026-09-11T00:00:00.000Z'

function session(id: string, seq: number, userId = 'user-a'): SessionRecord {
  return sessionFixture({
    id,
    userId,
    seq,
    title: id,
    agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    lastMessageAt: TIMESTAMP,
    parentSessionId: null,
    rootSessionId: id,
    sessionKind: 'chat',
    provenance: { kind: 'root' },
  })
}

function message(
  id: string,
  sessionId: string,
  content: string,
  options: {
    userId?: string
    role?: PersistedMessage['payload']['role']
    from?: PersistedMessage['payload']['from']
    isInternal?: boolean
  } = {},
): PersistedMessage {
  return {
    id,
    sessionId,
    userId: options.userId ?? 'user-a',
    payload: {
      id,
      role: options.role ?? 'assistant',
      from:
        options.from ?? (options.role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT),
      content,
      isInternal: options.isInternal,
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }
}

async function withRepo<T>(run: (repo: ReturnType<typeof createChatRepository>) => Promise<T>) {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  try {
    return await run(createChatRepository(db))
  } finally {
    await destroyDatabase(db)
  }
}

describe('lastMessagesByUser', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('one row per session — the newest message, with its author', async () => {
    await withRepo(async (repo) => {
      await repo.insertSession(session('a', 1))
      await repo.insertSession(session('b', 2))
      await repo.insertMessages([
        message('a1', 'a', 'first', { role: 'user' }),
        message('a2', 'a', 'the latest word', { from: agentParticipant('reviewer') }),
      ])
      await repo.insertMessages([message('b1', 'b', 'only one here', { role: 'user' })])

      const previews = await repo.lastMessagesByUser('user-a')

      expect(previews.size).toBe(2)
      // The AUTHOR, not the role: a list of sessions with several agents has to say who
      // spoke, and `assistant` is the same word for all of them.
      expect(previews.get('a')).toMatchObject({ text: 'the latest word', from: 'agent:reviewer' })
      expect(previews.get('b')).toMatchObject({ text: 'only one here', from: USER_PARTICIPANT })
    })
  })

  test('an internal row is not the conversation', async () => {
    // A wake persists a hidden user row carrying its prompt. Showing it as the preview would
    // put machinery the user never wrote at the top of their chat list.
    await withRepo(async (repo) => {
      await repo.insertSession(session('a', 1))
      await repo.insertMessages([
        message('a1', 'a', 'what the user can see'),
        message('a2', 'a', 'loop tick prompt', { role: 'user', isInternal: true }),
      ])

      expect((await repo.lastMessagesByUser('user-a')).get('a')?.text).toBe('what the user can see')
    })
  })

  test('the preview is one clamped line', async () => {
    await withRepo(async (repo) => {
      await repo.insertSession(session('a', 1))
      await repo.insertSession(session('b', 2))
      await repo.insertMessages([message('a1', 'a', `line one\n\n  line two\ttabbed  `)])
      await repo.insertMessages([message('b1', 'b', 'x'.repeat(400))])

      const previews = await repo.lastMessagesByUser('user-a')
      // Newlines would blow the row's fixed height; the clamp keeps a plan or a stack trace
      // from being shipped in full to render one ellipsized line.
      expect(previews.get('a')?.text).toBe('line one line two tabbed')
      expect(previews.get('b')?.text.endsWith('…')).toBe(true)
      expect(previews.get('b')!.text.length).toBeLessThanOrEqual(161)
    })
  })

  test('an empty message leaves the row without a preview', async () => {
    // A tool-only turn persists no content. A row is better with no second line than with
    // a blank one that looks like a rendering failure.
    await withRepo(async (repo) => {
      await repo.insertSession(session('a', 1))
      await repo.insertMessages([message('a1', 'a', '   ')])

      expect((await repo.lastMessagesByUser('user-a')).has('a')).toBe(false)
    })
  })

  test('another user is another list', async () => {
    await withRepo(async (repo) => {
      await repo.insertSession(session('mine', 1))
      await repo.insertSession(session('theirs', 2, 'user-b'))
      await repo.insertMessages([message('m1', 'mine', 'mine')])
      await repo.insertMessages([message('t1', 'theirs', 'theirs', { userId: 'user-b' })])

      const previews = await repo.lastMessagesByUser('user-a')
      expect([...previews.keys()]).toEqual(['mine'])
    })
  })
})
