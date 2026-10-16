import { expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { plaintextCipher } from './cipher'
import { createSecretsStore } from './store'

test('metadata, version and audit reads do not initialize the cipher', async () => {
  const db = createDatabase()
  try {
    await migrateToLatest(db)
    const writer = createSecretsStore({ db, cipher: plaintextCipher })
    const item = await writer.create('owner', {
      key: 'CATALOG_KEY',
      value: 'private-value',
      label: 'Catalog item',
      type: 'secret',
      tags: [],
    })
    expect(item).not.toBeNull()
    const reader = createSecretsStore({
      db,
      get cipher(): typeof plaintextCipher {
        throw new Error('Read-only catalog access must not load a cipher')
      },
    })

    expect(await reader.list('owner')).toEqual([item!])
    expect((await reader.listVersions('owner', 'CATALOG_KEY')).map((row) => row.version)).toEqual([
      1,
    ])
    expect((await reader.listAudit('owner')).map((row) => row.operation)).toEqual(['create'])
    expect(await reader.list('other')).toEqual([])
    expect(await reader.listVersions('other', 'CATALOG_KEY')).toEqual([])
    expect(await reader.listAudit('other')).toEqual([])
  } finally {
    await destroyDatabase(db)
  }
})
