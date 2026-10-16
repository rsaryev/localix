import { describe, expect, test } from 'bun:test'
import type { TableColumn } from '@localixai/dataview'
import type { DbTableSchema } from '../dbClient'
import { analyzeEditableSelect } from './editableSelect'
import { mapEditableResult } from './editableResult'

const users: DbTableSchema = {
  name: 'users',
  schema: 'public',
  type: 'table',
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, pk: true },
    { name: 'name', dataType: 'text', nullable: false, pk: false },
    { name: 'email', dataType: 'text', nullable: true, pk: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
}

const columns = (...titles: string[]): TableColumn[] =>
  titles.map((title, index) => ({ id: `${title}_${index}`, title, type: 'text' }))

describe('mapEditableResult', () => {
  test('requires the complete primary key and maps SELECT star labels', () => {
    const analysis = analyzeEditableSelect('select * from users where id = 1', 'postgres')!
    const mapped = mapEditableResult(analysis, users, columns('id', 'name', 'email'))
    expect(mapped?.sourceColumnById).toEqual({
      id_0: 'id',
      name_1: 'name',
      email_2: 'email',
    })
    expect([...mapped!.pkColumnIds]).toEqual(['id_0'])
  })

  test('maps aliases back to physical columns', () => {
    const analysis = analyzeEditableSelect(
      'select id user_id, name display_name from users',
      'postgres',
    )!
    const mapped = mapEditableResult(analysis, users, columns('user_id', 'display_name'))
    expect(mapped?.sourceColumnById).toEqual({ user_id_0: 'id', display_name_1: 'name' })
  })

  test('maps a prototype-named result alias as ordinary provenance', () => {
    const analysis = analyzeEditableSelect('SELECT id AS "__proto__" FROM users', 'postgres')!
    const mapped = mapEditableResult(analysis, users, [
      { id: '__proto__', title: '__proto__', type: 'text' },
    ])
    expect(mapped?.sourceColumnById).toEqual({ ['__proto__']: 'id' })
    expect([...mapped!.pkColumnIds]).toEqual(['__proto__'])
  })

  test('rejects a result that omitted the primary key', () => {
    const analysis = analyzeEditableSelect('select name from users', 'postgres')!
    expect(mapEditableResult(analysis, users, columns('name'))).toBeNull()
  })
})
