import { expect, test } from 'bun:test'
import { createDbSchemaTool, type DbSchemaPort, type DbSchemaTable } from './db-schema'

const tool = (tableSchema: DbSchemaPort['tableSchema']) =>
  createDbSchemaTool({
    userId: 'u',
    port: {
      listConnections: async () => [
        { id: 'c', name: 'Database', dialect: 'sqlite', connected: true, readonly: true },
      ],
      schemas: async () => {
        throw new Error('Table discovery must not fetch the schema tree')
      },
      tableSchema,
    },
  })

test('table introspection failures remain tool errors', async () => {
  const result = await tool(async () => {
    throw new Error('Driver unavailable')
  }).execute('t', { connection_id: 'c', table: 'items' })
  expect(result).toMatchObject({
    isError: true,
    content: 'Could not read "items": Driver unavailable',
  })
})

test('table presentation failures propagate outside the driver error boundary', async () => {
  const failure = new Error('Metadata unavailable')
  const table: DbSchemaTable = {
    name: 'items',
    type: 'table',
    columns: [{ name: 'id', dataType: 'integer', pk: true, nullable: false }],
    primaryKey: ['id'],
    foreignKeys: [],
    indexes: [],
    get comment(): string {
      throw failure
    },
  }
  await expect(
    tool(async () => table).execute('t', { connection_id: 'c', table: 'items' }),
  ).rejects.toBe(failure)
})
