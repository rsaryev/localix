import { describe, expect, it } from 'bun:test'
import { offsetAt, sqlCompletions, type SqlSchemaModel } from './sqlCompletion'

const model: SqlSchemaModel = {
  tables: ['users', 'orders'],
  columnsByTable: {
    users: ['id', 'name', 'email'],
    orders: ['id', 'user_id', 'total'],
  },
}

const labels = (items: ReturnType<typeof sqlCompletions>) => items.map((i) => i.label)

describe('sqlCompletions', () => {
  it('suggests table names right after FROM', () => {
    const text = 'SELECT * FROM '
    const items = sqlCompletions(text, text.length, model)
    expect(labels(items)).toEqual(['users', 'orders'])
    expect(items.every((i) => i.detail === 'table')).toBe(true)
  })

  it('does not mistake inherited Object prototype names for known tables', () => {
    const empty: SqlSchemaModel = { tables: [], columnsByTable: {}, foreignKeys: [] }
    expect(() => sqlCompletions('SELECT  FROM __proto__', 'SELECT '.length, empty)).not.toThrow()
    expect(() =>
      sqlCompletions('INSERT INTO __proto__ (', 'INSERT INTO __proto__ ('.length, empty),
    ).not.toThrow()
    for (const qualifier of ['constructor', '__proto__']) {
      const text = `SELECT ${qualifier}.`
      expect(sqlCompletions(text, text.length, empty)).toEqual([])
    }
  })

  it('offers `*` and an expand-columns snippet right after SELECT with a known FROM table', () => {
    const text = 'SELECT  FROM users'
    const items = sqlCompletions(text, 'SELECT '.length, model)
    expect(labels(items)).toContain('*')
    const expand = items.find((i) => i.label === 'users.* → columns')
    expect(expand?.insertText).toBe('id, name, email')
    expect(expand?.detail).toBe('expand users')
  })

  it('offers no expand snippet before a FROM table is written', () => {
    const text = 'SELECT '
    const items = sqlCompletions(text, text.length, model)
    expect(items.some((i) => i.label.endsWith('.* → columns'))).toBe(false)
  })

  it('offers a SELECT-list AS alias downstream (ORDER BY)', () => {
    const text = 'SELECT count(*) AS grand_total FROM users GROUP BY name ORDER BY '
    const items = sqlCompletions(text, text.length, model)
    const alias = items.find((i) => i.label === 'grand_total')
    expect(alias?.detail).toBe('alias')
  })

  it('scopes referenced-table column ordering to the current statement (multi-statement file)', () => {
    // Cursor in statement 2 (FROM orders). orders columns must come before users columns,
    // even though statement 1 references users — the sibling statement must not leak in.
    const text = 'SELECT * FROM users;\nSELECT  FROM orders'
    const offset = text.indexOf('SELECT  FROM orders') + 'SELECT '.length
    const cols = sqlCompletions(text, offset, model).filter((i) => i.kind === 5) // KIND_FIELD
    const firstOrders = cols.findIndex((i) => i.detail?.startsWith('orders'))
    const firstUsers = cols.findIndex((i) => i.detail?.startsWith('users'))
    expect(firstOrders).toBeGreaterThanOrEqual(0)
    expect(firstOrders).toBeLessThan(firstUsers)
  })

  it('scopes an alias to the current statement (no leak from a sibling)', () => {
    // `o.` in statement 2 must resolve via statement 2's `FROM orders o`, not statement 1.
    const text = 'SELECT * FROM users u;\nSELECT o. FROM orders o'
    const offset = text.indexOf('o. FROM') + 'o.'.length
    expect(labels(sqlCompletions(text, offset, model))).toEqual(['id', 'user_id', 'total'])
  })

  it('offers comparison operators right after a column in WHERE', () => {
    const text = 'SELECT * FROM users WHERE name '
    const l = labels(sqlCompletions(text, text.length, model))
    expect(l).toContain('=')
    expect(l).toContain('LIKE')
    expect(l).toContain('IS NULL')
    // Not columns/tables at this position.
    expect(l).not.toContain('email')
  })

  it('function completions carry a caret-stop insertText (COUNT(*), fn($0))', () => {
    const text = 'SELECT COU FROM users'
    const items = sqlCompletions(text, 'SELECT COU'.length, model)
    expect(items.find((i) => i.label === 'COUNT')?.insertText).toBe('COUNT(*)')
    expect(items.find((i) => i.label === 'LENGTH')?.insertText).toBe('LENGTH($0)')
  })

  it('IN/LIKE/BETWEEN operators carry an argument snippet', () => {
    const text = 'SELECT * FROM users WHERE name '
    const items = sqlCompletions(text, text.length, model)
    expect(items.find((i) => i.label === 'IN')?.insertText).toBe('IN ($0)')
    expect(items.find((i) => i.label === 'LIKE')?.insertText).toBe("LIKE '$0'")
    expect(items.find((i) => i.label === '=')?.insertText).toBeUndefined()
  })

  it('offers ASC/DESC right after a column in ORDER BY', () => {
    const text = 'SELECT * FROM users ORDER BY name '
    expect(labels(sqlCompletions(text, text.length, model))).toEqual(['ASC', 'DESC'])
  })

  it('does NOT offer operators right after the WHERE keyword (wants columns there)', () => {
    const text = 'SELECT * FROM users WHERE '
    const l = labels(sqlCompletions(text, text.length, model))
    expect(l).not.toContain('=')
    expect(l).toContain('email') // columns of the referenced table
  })

  it('does NOT offer operators after a column in the SELECT list', () => {
    const text = 'SELECT name  FROM users'
    const l = labels(sqlCompletions(text, 'SELECT name '.length, model))
    expect(l).not.toContain('=')
  })

  it('resolves a schema-qualified table alias to its columns', () => {
    const text = 'SELECT u. FROM public.users u'
    const items = sqlCompletions(text, 'SELECT u.'.length, model)
    // u → public.users → bare `users` key → its columns.
    expect(labels(items)).toContain('id')
    expect(labels(items)).toContain('name')
  })

  it('offers a WITH CTE name as a table after FROM', () => {
    const text = 'WITH recent AS (SELECT * FROM orders) SELECT * FROM '
    const items = sqlCompletions(text, text.length, model)
    const cte = items.find((i) => i.label === 'recent')
    expect(cte?.detail).toBe('cte')
    // schema tables still follow
    expect(labels(items)).toContain('users')
  })

  it('suggests table names after JOIN', () => {
    const text = 'SELECT * FROM users JOIN '
    expect(labels(sqlCompletions(text, text.length, model))).toEqual(['users', 'orders'])
  })

  it('completes columns for a dotted table name', () => {
    const text = 'SELECT users. FROM users'
    const offset = text.indexOf('users.') + 'users.'.length
    const items = sqlCompletions(text, offset, model)
    expect(labels(items)).toEqual(['id', 'name', 'email'])
    expect(items.every((i) => i.detail === 'users')).toBe(true)
  })

  it('resolves an alias to its table for dotted columns', () => {
    const text = 'SELECT o. FROM orders AS o'
    const offset = text.indexOf('o.') + 'o.'.length
    expect(labels(sqlCompletions(text, offset, model))).toEqual(['id', 'user_id', 'total'])
  })

  it('resolves an alias without AS', () => {
    const text = 'SELECT u. FROM users u'
    const offset = text.indexOf('u.') + 'u.'.length
    expect(labels(sqlCompletions(text, offset, model))).toEqual(['id', 'name', 'email'])
  })

  it('offers a full FK-based JOIN snippet right after JOIN', () => {
    const fkModel: SqlSchemaModel = {
      ...model,
      foreignKeys: [
        { table: 'orders', columns: ['user_id'], refTable: 'users', refColumns: ['id'] },
      ],
    }
    const text = 'SELECT * FROM users JOIN '
    const items = sqlCompletions(text, text.length, fkModel)
    expect(items[0].label).toBe('orders ON orders.user_id = users.id')
    expect(items[0].detail).toBe('join')
    // plain table names still follow as a fallback
    expect(labels(items)).toContain('orders')
  })

  it('shows column type + PK in the detail when columnMeta is present', () => {
    const typed: SqlSchemaModel = {
      ...model,
      columnMeta: {
        users: { id: { type: 'INTEGER', pk: true }, email: { type: 'varchar(255)' } },
      },
    }
    const text = 'SELECT users. FROM users'
    const offset = text.indexOf('users.') + 'users.'.length
    const items = sqlCompletions(text, offset, typed)
    expect(items.find((i) => i.label === 'id')?.detail).toBe('users · INTEGER · PK')
    expect(items.find((i) => i.label === 'email')?.detail).toBe('users · varchar(255)')
  })

  it('offers * first right after SELECT, then referenced columns', () => {
    const text = 'SELECT  FROM users'
    const offset = 'SELECT '.length // cursor right after "SELECT "
    const items = sqlCompletions(text, offset, model)
    expect(items[0].label).toBe('*')
    expect(labels(items)).toContain('name')
  })

  it('suggests the target table columns inside an INSERT column list', () => {
    const text = 'INSERT INTO orders ('
    const items = sqlCompletions(text, text.length, model)
    expect(labels(items)).toEqual(['id', 'user_id', 'total'])
    expect(items.every((i) => i.detail === 'orders')).toBe(true)
  })

  it('keeps suggesting remaining columns after the first in an INSERT list', () => {
    const text = 'INSERT INTO orders (id, '
    expect(labels(sqlCompletions(text, text.length, model))).toEqual(['id', 'user_id', 'total'])
  })

  it('offers columns, tables and keywords in a general position', () => {
    const text = 'SELECT '
    const items = sqlCompletions(text, text.length, model)
    const ls = labels(items)
    expect(ls).toContain('name') // column
    expect(ls).toContain('users') // table
    expect(ls).toContain('WHERE') // keyword
  })

  it('offers only statement-leading keywords at the start', () => {
    const text = 'SEL'
    const items = sqlCompletions(text, text.length, model)
    const ls = labels(items)
    expect(ls).toContain('SELECT')
    expect(ls).toContain('INSERT INTO')
    // No columns/tables at a bare statement start.
    expect(ls).not.toContain('name')
    expect(ls).not.toContain('users')
  })

  it('offers leading keywords at the start of a second statement after `;`', () => {
    const text = 'SELECT 1;\n'
    const items = sqlCompletions(text, text.length, model)
    expect(labels(items)).toContain('SELECT')
  })

  it('follows the casing of the word being typed', () => {
    // Lowercase input → lowercase keyword labels.
    const lower = sqlCompletions('sel', 3, model)
    expect(labels(lower)).toContain('select')
    expect(labels(lower)).not.toContain('SELECT')
    // Uppercase input → uppercase.
    const upper = sqlCompletions('SEL', 3, model)
    expect(labels(upper)).toContain('SELECT')
  })

  it('offers SQL functions in a general position', () => {
    const text = 'SELECT '
    const items = sqlCompletions(text, text.length, model)
    const fns = items.filter((i) => i.detail === 'function').map((i) => i.label)
    expect(fns).toContain('COUNT')
    expect(fns).toContain('COALESCE')
  })

  it('scopes columns to the referenced table first', () => {
    // `SELECT | FROM orders` — orders' columns should lead over users'.
    const text = 'SELECT  FROM orders'
    const offset = 'SELECT '.length
    const items = sqlCompletions(text, offset, model)
    const cols = items.filter((i) => i.kind === 5).map((i) => i.detail)
    // First column belongs to the referenced table.
    expect(cols[0]).toBe('orders')
    // Users' columns still appear as a fallback further down.
    expect(cols).toContain('users')
  })

  it('scopes to multiple joined tables before other tables', () => {
    const text = 'SELECT  FROM users JOIN orders'
    const offset = 'SELECT '.length
    const items = sqlCompletions(text, offset, model)
    const firstTwoTables = items
      .filter((i) => i.kind === 5)
      .slice(0, 6)
      .map((i) => i.detail)
    expect(new Set(firstTwoTables)).toEqual(new Set(['users', 'orders']))
  })

  const fkModel: SqlSchemaModel = {
    ...model,
    foreignKeys: [{ table: 'orders', columns: ['user_id'], refTable: 'users', refColumns: ['id'] }],
  }

  it('suggests an FK-based join condition right after ON', () => {
    const text = 'SELECT * FROM users JOIN orders ON '
    const items = sqlCompletions(text, text.length, fkModel)
    expect(labels(items)[0]).toBe('orders.user_id = users.id')
    expect(items[0].detail).toBe('foreign key')
  })

  it('renders join conditions with query aliases', () => {
    const text = 'SELECT * FROM users u JOIN orders o ON '
    const items = sqlCompletions(text, text.length, fkModel)
    expect(labels(items)[0]).toBe('o.user_id = u.id')
  })

  it('falls back to referenced columns after ON when no FK links the tables', () => {
    const text = 'SELECT * FROM users JOIN orders ON '
    const items = sqlCompletions(text, text.length, model) // no foreignKeys
    // No condition, but still offers columns of the referenced tables.
    expect(items.some((i) => i.detail === 'foreign key')).toBe(false)
    expect(labels(items)).toContain('user_id')
  })

  it('does not treat a trailing keyword as an alias', () => {
    // "FROM users WHERE" — WHERE must not become an alias for users.
    const text = 'SELECT x. FROM users WHERE'
    const offset = text.indexOf('x.') + 'x.'.length
    // x is unknown → falls back to all columns (not crash, not WHERE-as-alias).
    const items = sqlCompletions(text, offset, model)
    expect(items.length).toBeGreaterThan(0)
  })
})

describe('offsetAt', () => {
  it('computes an offset from a line/character position', () => {
    const text = 'line0\nline1\nline2'
    expect(offsetAt(text, 0, 0)).toBe(0)
    expect(offsetAt(text, 1, 0)).toBe(6)
    expect(offsetAt(text, 2, 3)).toBe(12 + 3)
  })
})
