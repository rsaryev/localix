import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMiniAppAutoUpdate } from './auto-update'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const notices = async () =>
    (await db.selectFrom('change_events').select(['entity', 'ref_json']).execute()).map(
      (row) => `${row.entity} ${row.ref_json}`,
    )
  return { autoUpdate: createMiniAppAutoUpdate({ db }), notices }
}

describe('whether an installed mini app updates on its own', () => {
  test('it does, until the person says otherwise', async () => {
    const { autoUpdate } = await setup()
    expect(await autoUpdate.off()).toEqual(new Set())
  })

  test('switched off and on again, each time announced for the Store to read again', async () => {
    const { autoUpdate, notices } = await setup()
    await autoUpdate.set('atlas', false)
    expect(await autoUpdate.off()).toEqual(new Set(['atlas']))

    await autoUpdate.set('atlas', true)
    expect(await autoUpdate.off()).toEqual(new Set())
    expect(await notices()).toEqual([
      'mini-app.updates {"id":"atlas"}',
      'mini-app.updates {"id":"atlas"}',
    ])
  })
})
