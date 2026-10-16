/**
 * The migration that retires the share-of-window setting edits user settings, so what it keeps is
 * pinned here: `contextPercent` leaves every entry, an entry it was the only setting of goes, and
 * every other setting — and every other key of the blob — stays as it was, in order.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { sql, type Kysely } from 'kysely'

import { up } from '../../migrations/20261020T000000_drop_context_percent'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import type { AppDatabase } from './types'

const databases: Kysely<AppDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)))
})

async function withProfiles(profiles: Record<string, string | null>) {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  for (const [userId, settings] of Object.entries(profiles))
    await sql`INSERT INTO user_profiles (user_id, agent_settings) VALUES (${userId}, ${settings})`.execute(
      db,
    )
  return db
}

const settingsOf = async (db: Kysely<AppDatabase>, userId: string) => {
  const row = await sql<{ agent_settings: string | null }>`
    SELECT agent_settings FROM user_profiles WHERE user_id = ${userId}`.execute(db)
  const raw = row.rows[0]?.agent_settings
  return raw ? JSON.parse(raw) : raw
}

const triple = (agentId: string) => ({ agentId, providerId: 'openai', modelId: 'gpt' })

describe('drop context percent migration', () => {
  test('removes the share, drops entries it alone held, keeps everything else in order', async () => {
    const db = await withProfiles({
      u: JSON.stringify({
        maxTurns: 40,
        agentModelSettings: [
          { ...triple('a'), effort: 'high', contextPercent: 50 },
          { ...triple('b'), contextPercent: 70 },
          { ...triple('c'), maxTurns: 5 },
          { ...triple('d'), contextPercent: 30, contextLimit: 600000 },
        ],
      }),
    })
    await up(db as unknown as Kysely<unknown>)
    expect(await settingsOf(db, 'u')).toEqual({
      maxTurns: 40,
      agentModelSettings: [
        { ...triple('a'), effort: 'high' },
        { ...triple('c'), maxTurns: 5 },
        { ...triple('d'), contextLimit: 600000 },
      ],
    })
  })

  test('an entry list that only held shares becomes empty, not absent', async () => {
    const db = await withProfiles({
      u: JSON.stringify({ agentModelSettings: [{ ...triple('a'), contextPercent: 50 }] }),
    })
    await up(db as unknown as Kysely<unknown>)
    expect(await settingsOf(db, 'u')).toEqual({ agentModelSettings: [] })
  })

  test('settings without a share, without entries, empty or invalid are left untouched', async () => {
    const untouched = {
      clean: JSON.stringify({ agentModelSettings: [{ ...triple('a'), effort: 'low' }] }),
      noEntries: JSON.stringify({ maxTurns: 3 }),
      notArray: JSON.stringify({ agentModelSettings: 'x' }),
      invalid: '{not json',
      empty: null,
    }
    const db = await withProfiles(untouched)
    await up(db as unknown as Kysely<unknown>)
    for (const [userId, raw] of Object.entries(untouched)) {
      const row = await sql<{ agent_settings: string | null }>`
        SELECT agent_settings FROM user_profiles WHERE user_id = ${userId}`.execute(db)
      expect(row.rows[0]?.agent_settings).toBe(raw)
    }
  })
})
