import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository } from './repository'
import { sessionFixture } from '../../testing/session-fixture'
import { createParticipantLaneSnapshotRepository } from './participant-lane-snapshot-repository'

test('snapshots survive a database reopen with isolated agents, boundaries, and ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lane-snapshots-'))
  const filename = join(dir, 'test.sqlite')
  let db = createDatabase({ filename })
  try {
    await migrateToLatest(db)
    const session = sessionFixture({ id: 'room', userId: 'owner' })
    await createChatRepository(db).insertSession(session)
    const a = { sessionId: 'room', agentId: 'a' }
    const b = { sessionId: 'room', agentId: 'b' }
    let snapshots = createParticipantLaneSnapshotRepository(db)
    const initial = { memoryContext: 'secret A', skillsContext: 'skill A' }
    await snapshots.set('owner', a, '', initial)
    await snapshots.set('owner', b, '', { memoryContext: 'secret B' })
    await snapshots.set('owner', a, 'compact-a', { memoryContext: 'new prefix' })
    await destroyDatabase(db)
    db = createDatabase({ filename })
    await migrateToLatest(db)
    snapshots = createParticipantLaneSnapshotRepository(db)
    expect(JSON.stringify(await snapshots.get('owner', a, ''))).toBe(JSON.stringify(initial))
    expect(await snapshots.get('owner', b, '')).toEqual({
      memoryContext: 'secret B',
    })
    expect(await snapshots.get('owner', a, 'compact-a')).toEqual({ memoryContext: 'new prefix' })
    expect(await snapshots.get('owner', b, 'compact-a')).toBeUndefined()
    expect(await snapshots.get('outsider', a, '')).toBeUndefined()
    await expect(snapshots.set('outsider', a, '', initial)).rejects.toThrow('unavailable')
    await db.deleteFrom('agent_sessions').where('id', '=', 'room').execute()
    expect(await db.selectFrom('participant_lane_snapshots').selectAll().execute()).toEqual([])
  } finally {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  }
})
