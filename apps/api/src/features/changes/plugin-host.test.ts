import { describe, expect, test } from 'bun:test'
import type { PluginChange } from '@localixai/plugin-sdk/backend'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginChangeHosts } from './plugin-host'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const logged: string[] = []
  const hosts = createPluginChangeHosts({ db, log: (event) => logged.push(event) })
  return { db, hosts, logged }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 120))

describe('host.changes', () => {
  test("a plugin's notices reach its own consumer, never another plugin's", async () => {
    const { hosts } = await setup()
    const board = hosts.forPlugin('board')
    const notes = hosts.forPlugin('notes')
    const seenByBoard: PluginChange[] = []
    const seenByNotes: PluginChange[] = []
    const stopBoard = await board.subscribe('index', (change) => void seenByBoard.push(change))
    const stopNotes = await notes.subscribe('index', (change) => void seenByNotes.push(change))
    board.record([
      { entity: 'card', op: 'upserted', ref: { id: 'c1' } },
      { entity: 'card', op: 'resync' },
    ])
    await tick()
    expect(seenByBoard).toEqual([
      { entity: 'card', op: 'upserted', ref: { id: 'c1' } },
      { entity: 'card', op: 'resync' },
    ])
    expect(seenByNotes).toEqual([])
    await stopBoard()
    await stopNotes()
    await hosts.close()
  })

  test('a kind with an invalid name is dropped and logged, the rest recorded', async () => {
    const { db, hosts, logged } = await setup()
    hosts.forPlugin('board').record([
      { entity: 'Bad Name', op: 'resync' },
      { entity: 'card', op: 'resync' },
    ])
    await tick()
    const rows = await db.selectFrom('change_events').select(['stream', 'entity']).execute()
    expect(rows).toEqual([{ stream: 'plugin:board', entity: 'card' }])
    expect(logged).toContain('changes.plugin_invalid_entity')
    await hosts.close()
  })
})
