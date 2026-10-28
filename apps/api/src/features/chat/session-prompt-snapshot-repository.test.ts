import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository } from './repository'
import { sessionFixture } from '../../testing/session-fixture'
import { createSessionPromptSnapshotRepository } from './session-prompt-snapshot-repository'

test('snapshots survive a database reopen with isolated boundaries and ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-snapshots-'))
  const filename = join(dir, 'test.sqlite')
  let db = createDatabase({ filename })
  try {
    await migrateToLatest(db)
    await createChatRepository(db).insertSession(sessionFixture({ id: 'chat', userId: 'owner' }))
    let snapshots = createSessionPromptSnapshotRepository(db)
    const initial = { memoryContext: 'secret A', skillsContext: 'skill A' }
    await snapshots.set('owner', 'chat', '', initial)
    await snapshots.set('owner', 'chat', 'compact-a', { memoryContext: 'new prefix' })
    await destroyDatabase(db)
    db = createDatabase({ filename })
    await migrateToLatest(db)
    snapshots = createSessionPromptSnapshotRepository(db)
    expect(JSON.stringify(await snapshots.get('owner', 'chat', ''))).toBe(JSON.stringify(initial))
    expect(await snapshots.get('owner', 'chat', 'compact-a')).toEqual({
      memoryContext: 'new prefix',
    })
    expect(await snapshots.get('owner', 'chat', 'other')).toBeUndefined()
    expect(await snapshots.get('outsider', 'chat', '')).toBeUndefined()
    await expect(snapshots.set('outsider', 'chat', '', initial)).rejects.toThrow('unavailable')
    await db.deleteFrom('agent_sessions').where('id', '=', 'chat').execute()
    expect(await db.selectFrom('session_prompt_snapshots').selectAll().execute()).toEqual([])
  } finally {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  }
})
