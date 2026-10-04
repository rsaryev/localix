import { describe, expect, it } from 'bun:test'
import { sqlTableLinkTargets } from './sqlTableLinks'

const names = (sql: string, tables: string[]) =>
  sqlTableLinkTargets(sql, new Set(tables)).map((target) => target.name)

describe('sqlTableLinkTargets', () => {
  it('links known table occurrences but ignores comments and string literals', () => {
    expect(names("SELECT users.id FROM users WHERE note = 'users' -- users\n", ['users'])).toEqual([
      'users',
      'users',
    ])
  })

  it('keeps relation targets discoverable while the schema is loading', () => {
    expect(names('SELECT * FROM users JOIN teams ON teams.id = users.team_id', [])).toEqual([
      'users',
      'teams',
    ])
  })

  it('supports quoted identifiers and FROM ONLY without linking ordinary columns', () => {
    expect(names('SELECT total FROM ONLY "Order Items"', [])).toEqual(['Order Items'])
  })

  it('returns exact source offsets for Monaco ranges', () => {
    const sql = 'UPDATE `users` SET name = 1'
    expect(sqlTableLinkTargets(sql, new Set())).toEqual([{ start: 7, end: 14, name: 'users' }])
  })
})
