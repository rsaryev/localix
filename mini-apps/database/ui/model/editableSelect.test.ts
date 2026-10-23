import { describe, expect, test } from 'bun:test'
import { analyzeEditableSelect } from './editableSelect'

describe('analyzeEditableSelect', () => {
  test('accepts a filtered single-table SELECT', () => {
    expect(analyzeEditableSelect('select * from users where id = 1;', 'postgres')).toEqual({
      table: 'users',
      schema: undefined,
      wildcard: true,
      columns: {},
    })
  })

  test('supports schema/table aliases and direct column aliases', () => {
    expect(
      analyzeEditableSelect(
        'SELECT u.id AS user_id, u.name display_name FROM "public"."users" AS u ORDER BY u.id',
        'postgres',
      ),
    ).toEqual({
      table: 'users',
      schema: 'public',
      wildcard: false,
      columns: { user_id: 'id', display_name: 'name' },
    })
  })

  test('keeps a prototype-named result alias as explicit provenance', () => {
    const analysis = analyzeEditableSelect('SELECT id AS "__proto__" FROM users', 'postgres')!
    expect(Object.hasOwn(analysis.columns, '__proto__')).toBe(true)
    expect(analysis.columns).toEqual({ ['__proto__']: 'id' })
  })

  test.each([
    'SELECT * FROM users JOIN teams ON teams.id = users.team_id',
    'SELECT count(*) FROM users',
    'SELECT * FROM (SELECT * FROM users) u',
    'SELECT * FROM users UNION SELECT * FROM archived_users',
    'SELECT * FROM users; SELECT * FROM teams',
  ])('rejects result provenance that is not one direct table: %s', (sql) => {
    expect(analyzeEditableSelect(sql, 'postgres')).toBeNull()
  })
})

// The gate used to strip literals with its own dialect-blind scanner. An apostrophe inside a
// `$$` body or a MySQL `#` comment opened a fake string that swallowed the set operation after
// it, so a result holding ANOTHER table's rows was offered for inline editing as `users`.
describe('analyzeEditableSelect reads literals and comments per dialect', () => {
  test('a Postgres $$ body cannot hide a UNION from the gate', () => {
    const sql =
      "SELECT id, name FROM users WHERE note = $$it's$$ UNION SELECT id, name FROM admins WHERE x = 'y'"
    expect(analyzeEditableSelect(sql, 'postgres')).toBeNull()
  })

  test('a MySQL # comment cannot hide a UNION from the gate', () => {
    const sql =
      "SELECT id, name FROM users WHERE id = 1 # it's\nUNION SELECT id, name FROM admins WHERE n = 'x'"
    expect(analyzeEditableSelect(sql, 'mysql')).toBeNull()
  })

  test('SQL-looking text inside a $$ body or a # comment is data, not a blocked keyword', () => {
    expect(
      analyzeEditableSelect("SELECT * FROM users WHERE note = $$ JOIN teams; it's $$", 'postgres'),
    ).toMatchObject({ table: 'users', wildcard: true })
    expect(
      analyzeEditableSelect('SELECT * FROM users WHERE id = 1 # JOIN teams', 'mysql'),
    ).toMatchObject({ table: 'users', wildcard: true })
  })

  test('a nested Postgres block comment is one comment, not a comment and trailing code', () => {
    const sql = 'SELECT * FROM users /* outer /* inner */ UNION SELECT * FROM admins */'
    expect(analyzeEditableSelect(sql, 'postgres')).toMatchObject({ table: 'users' })
  })
})
