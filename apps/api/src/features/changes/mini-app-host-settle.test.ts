import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed } from './core-entities'
import { createMiniAppChangeHosts } from './mini-app-host'

describe('host.changes when the backend host settles a reload', () => {
  test('a discarded duplicate does not take over the wired backend, a rebuild does', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const hosts = createMiniAppChangeHosts({ db, core: createCoreChangeFeed(db) })
    const seen: string[] = []
    const board = (load: string) =>
      hosts.forMiniApp('board').subscribe('index', () => void seen.push(load))
    await board('wired')
    hosts.settleMiniApp('board', 'replaced')
    await board('duplicate')
    hosts.settleMiniApp('board', 'kept')
    hosts.forMiniApp('board').record([{ entity: 'card', op: 'resync' }])
    await hosts.settle()
    expect(seen).toEqual(['wired'])

    await board('rebuilt')
    hosts.settleMiniApp('board', 'replaced')
    hosts.forMiniApp('board').record([{ entity: 'card', op: 'resync' }])
    await hosts.settle()
    expect(seen).toEqual(['wired', 'rebuilt'])
    await hosts.releaseMiniApp('board')
    await hosts.close()
  })
})
