import { afterEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { up } from '../../migrations/20261006T000000_system_notice_tone'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { deserializeMessagePayload } from './payload'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

/**
 * A notice stored before the one tone vocabulary must still render. The codec reads only the
 * current shape, so the migration is what carries `muted` → `neutral` and `'retry'` →
 * `['retry']`; without it an old row reached the renderer with a tone its map has no class for.
 */
describe('stored transcript notices move onto the one tone and the recovery list', () => {
  test('rewrites old rows and leaves current ones alone', async () => {
    const db = createDatabase()
    databases.push(db)
    await migrateToLatest(db)
    await db
      .insertInto('agent_sessions')
      .values({ id: 's1', user_id: 'u1', project_id: 'PRJ-test', title: 'T' })
      .execute()
    const row = (id: string, systemNotice: Record<string, unknown>, sequence: number) => ({
      id,
      session_id: 's1',
      user_id: 'u1',
      sequence,
      role: 'assistant' as const,
      payload_json: JSON.stringify({
        v: 1,
        id,
        role: 'assistant',
        from: { kind: 'system' },
        content: 'x',
        systemNotice,
      }),
    })
    await db
      .insertInto('agent_messages')
      .values([
        row('old', { kind: 'run_interrupted', tone: 'muted', text: 'x', recovery: 'retry' }, 0),
        row('new', { kind: 'run_failed', tone: 'error', text: 'y', recovery: ['retry'] }, 1),
      ])
      .execute()

    await up(db as unknown as Kysely<unknown>)

    const read = async (id: string) =>
      deserializeMessagePayload(
        (
          await db
            .selectFrom('agent_messages')
            .select('payload_json')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).payload_json,
      ).systemNotice
    expect(await read('old')).toMatchObject({ tone: 'neutral', recovery: ['retry'] })
    expect(await read('new')).toMatchObject({ tone: 'error', recovery: ['retry'] })
  })
})
