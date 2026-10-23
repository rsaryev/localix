import { expect, test } from 'bun:test'
import { createSqliteDriver } from './sqlite'
import type { DbTransaction } from './port'

test('catalog reads wait for a manual transaction and observe the rolled-back schema', async () => {
  const driver = createSqliteDriver({ file: ':memory:' })
  let transaction: DbTransaction | undefined
  try {
    await driver.query('CREATE TABLE stable (id INTEGER PRIMARY KEY)')
    transaction = await driver.beginTransaction!()
    await transaction.query('CREATE TABLE pending (id INTEGER)')
    await transaction.query('ALTER TABLE stable ADD COLUMN pending_value TEXT')
    let schemasResolved = false
    let tableResolved = false
    const schemas = driver.schemas().then((result) => {
      schemasResolved = true
      return result
    })
    const table = driver.tableSchema(undefined, 'stable').then((result) => {
      tableResolved = true
      return result
    })
    await Promise.resolve()
    expect(schemasResolved).toBe(false)
    expect(tableResolved).toBe(false)
    await transaction.rollback()
    expect(await schemas).toEqual({ main: [{ name: 'stable', type: 'table' }] })
    expect((await table).columns.map((column) => column.name)).toEqual(['id'])
  } finally {
    await transaction?.rollback()
    await driver.close()
  }
})
