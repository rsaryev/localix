import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildIndexStatements, buildTriggerStatements } from './ddl'
import { createSqliteDriver } from './drivers/sqlite'
import { buildMssqlPoolConfig } from './drivers/mssql'
import { shapePgValuesResult } from './drivers/postgres'
import type { DbDriver } from './drivers/port'
import { mapDbError } from './errors'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const newService = () =>
  createDatabaseService({
    store: createConnectionStore({
      dir: path.join(dir, `store-${Math.random().toString(36).slice(2)}`),
    }),
  })

let dir: string
let dbFile: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'localix-db-test-'))
  dbFile = path.join(dir, 'test.db')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sqlite driver', () => {
  it('runs DDL/DML, introspects schema, and returns row-major results', async () => {
    const driver = createSqliteDriver({ file: dbFile })

    expect(driver.getFlags().dialect).toBe('sqlite')
    expect(driver.getFlags().supportsMultipleSchemas).toBe(false)

    await driver.query('CREATE TABLE orgs (id INTEGER PRIMARY KEY, label TEXT)')
    await driver.query('INSERT INTO orgs (id, label) VALUES (7, ?)', ['Acme'])
    await driver.query(
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, org_id INTEGER,
         FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL ON UPDATE CASCADE)`,
    )
    const ins = await driver.query('INSERT INTO users (name, org_id) VALUES (?, ?)', ['Ada', 7])
    expect(ins.rowsAffected).toBe(1)
    expect(ins.lastInsertId).toBe(1)

    const sel = await driver.query('SELECT id, name, org_id FROM users')
    expect(sel.columns.map((c) => c.name)).toEqual(['id', 'name', 'org_id'])
    expect(sel.rows).toEqual([[1, 'Ada', 7]])
    expect(sel.durationMs).toBeGreaterThanOrEqual(0)

    const schemas = await driver.schemas()
    expect(schemas.main.some((t) => t.name === 'users' && t.type === 'table')).toBe(true)

    const table = await driver.tableSchema(undefined, 'users')
    expect(table.primaryKey).toEqual(['id'])
    expect(table.columns.find((c) => c.name === 'id')?.nullable).toBe(false)
    const nameCol = table.columns.find((c) => c.name === 'name')
    expect(nameCol?.nullable).toBe(false)
    expect(table.foreignKeys[0]).toMatchObject({
      columns: ['org_id'],
      refTable: 'orgs',
      refColumns: ['id'],
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    expect(table.createScript).toContain('CREATE TABLE')

    await driver.close()
  })

  it('introspects indexes (unique, primary, ordered columns)', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    // Composite PK so SQLite materializes a pk-origin auto-index (an INTEGER PRIMARY KEY
    // is a rowid alias with no separate index).
    await driver.query(
      'CREATE TABLE items (region TEXT, code INTEGER, sku TEXT, serial TEXT UNIQUE, a INTEGER, b INTEGER, PRIMARY KEY(region, code))',
    )
    await driver.query('CREATE UNIQUE INDEX idx_sku ON items(sku)')
    await driver.query('CREATE INDEX idx_ab ON items(a, b)')
    await driver.query('CREATE UNIQUE INDEX idx_partial ON items(sku) WHERE a = 1')
    await driver.query('CREATE INDEX idx_expression ON items(lower(sku), b)')

    const table = await driver.tableSchema(undefined, 'items')
    const byName = Object.fromEntries(table.indexes.map((i) => [i.name, i]))
    expect(byName.idx_sku).toMatchObject({ columns: ['sku'], unique: true })
    expect(byName.idx_sku?.createScript).toContain('CREATE UNIQUE INDEX idx_sku ON items(sku)')
    expect(byName.idx_ab).toMatchObject({ columns: ['a', 'b'], unique: false })
    expect(byName.idx_partial).toMatchObject({
      columns: ['sku'],
      unique: true,
      createScriptOnly: true,
      createScript: 'CREATE UNIQUE INDEX idx_partial ON items(sku) WHERE a = 1',
    })
    expect(byName.idx_expression).toMatchObject({
      columns: [],
      unique: false,
      createScriptOnly: true,
      createScript: 'CREATE INDEX idx_expression ON items(lower(sku), b)',
    })
    expect(buildIndexStatements(table, 'sqlite')).toContain(
      'CREATE UNIQUE INDEX idx_partial ON items(sku) WHERE a = 1;',
    )
    expect(buildIndexStatements(table, 'sqlite')).toContain(
      'CREATE INDEX idx_expression ON items(lower(sku), b);',
    )
    const uniqueConstraint = table.indexes.find(
      (index) => index.columns.length === 1 && index.columns[0] === 'serial',
    )
    expect(uniqueConstraint).toMatchObject({ unique: true, constraint: true })
    expect(uniqueConstraint?.createScript).toBeUndefined()
    // The PK-backing auto-index is reported with primary=true and its key columns in order.
    const pkIdx = table.indexes.find((i) => i.primary === true)
    expect(pkIdx).toBeDefined()
    expect(pkIdx?.columns).toEqual(['region', 'code'])

    await driver.close()
  })

  it('quotes identifiers so introspection is injection-safe', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE "weird ""name" (a INTEGER)')
    const table = await driver.tableSchema(undefined, 'weird "name')
    expect(table.columns.map((c) => c.name)).toEqual(['a'])
    await driver.close()
  })

  it('preserves native SQLite triggers beside their table DDL', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)')
    await driver.query('CREATE TABLE audit (item_id INTEGER, value TEXT)')
    await driver.query(
      'CREATE TRIGGER items_audit AFTER INSERT ON items ' +
        'BEGIN INSERT INTO audit(item_id, value) VALUES (NEW.id, NEW.value); END',
    )

    const table = await driver.tableSchema(undefined, 'items')

    expect(table.triggers).toEqual([
      {
        name: 'items_audit',
        createScript:
          'CREATE TRIGGER items_audit AFTER INSERT ON items ' +
          'BEGIN INSERT INTO audit(item_id, value) VALUES (NEW.id, NEW.value); END',
      },
    ])
    expect(buildTriggerStatements(table)).toEqual([
      'CREATE TRIGGER items_audit AFTER INSERT ON items ' +
        'BEGIN INSERT INTO audit(item_id, value) VALUES (NEW.id, NEW.value); END;',
    ])

    await driver.close()
  })

  it('keeps an implicit referenced primary key representable', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE parents (id INTEGER PRIMARY KEY)')
    await driver.query(
      'CREATE TABLE children (parent_id INTEGER REFERENCES parents ON DELETE CASCADE)',
    )

    expect((await driver.tableSchema(undefined, 'children')).foreignKeys).toEqual([
      {
        columns: ['parent_id'],
        refTable: 'parents',
        refColumns: [],
        onUpdate: 'NO ACTION',
        onDelete: 'CASCADE',
      },
    ])

    await driver.close()
  })

  it('releases prepared statements so schema editing works after browsing and introspection', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE editable (id INTEGER PRIMARY KEY, name TEXT)')
    await driver.query('SELECT * FROM editable')
    await driver.schemas()
    await driver.tableSchema(undefined, 'editable')

    await driver.query('ALTER TABLE editable ADD COLUMN note TEXT')
    expect(
      (await driver.tableSchema(undefined, 'editable')).columns.map((column) => column.name),
    ).toEqual(['id', 'name', 'note'])
    await driver.query('DROP TABLE editable')
    expect((await driver.schemas()).main.some((table) => table.name === 'editable')).toBe(false)

    await driver.close()
  })

  it('transaction commits all statements atomically, and rolls back on any failure', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)')

    // Happy path: both inserts land.
    const results = await driver.transaction!([
      { sql: 'INSERT INTO t (v) VALUES (1)' },
      { sql: 'INSERT INTO t (v) VALUES (2)' },
    ])
    expect(results).toHaveLength(2)
    expect(results[0].rowsAffected).toBe(1)
    const okCount = await driver.query('SELECT COUNT(*) FROM t')
    expect(okCount.rows[0][0]).toBe(2)

    // A batch with a bad statement rolls back the earlier good ones (nothing partial).
    expect(
      driver.transaction!([
        { sql: 'INSERT INTO t (v) VALUES (3)' },
        { sql: 'INSERT INTO nope VALUES (1)' },
      ]),
    ).rejects.toThrow()
    const afterFail = await driver.query('SELECT COUNT(*) FROM t')
    expect(afterFail.rows[0][0]).toBe(2) // still 2 — the v=3 insert was rolled back

    await driver.close()
  })

  it('rolls back and releases the manual lease when COMMIT fails', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE parents (id INTEGER PRIMARY KEY)')
    await driver.query(
      `CREATE TABLE children (
        parent_id INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED
      )`,
    )

    const tx = await driver.beginTransaction!()
    await tx.query('INSERT INTO children (parent_id) VALUES (99)')
    expect(tx.commit()).rejects.toThrow(/FOREIGN KEY constraint failed/)

    // The failed COMMIT must not leave its transaction attached to the now-released
    // single connection: its write is gone and a fresh BEGIN can acquire the lease.
    expect((await driver.query('SELECT COUNT(*) FROM children')).rows).toEqual([[0]])
    const next = await driver.beginTransaction!()
    await next.rollback()

    await driver.close()
  })

  it('isolates concurrent work from manual and batch transactions on its single handle', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE isolated (id INTEGER PRIMARY KEY)')

    const manual = await driver.beginTransaction!()
    await manual.query('INSERT INTO isolated VALUES (1)')
    let outsideFinished = false
    const outside = driver.query('INSERT INTO isolated VALUES (2)').then(() => {
      outsideFinished = true
    })
    await Promise.resolve()
    expect(outsideFinished).toBe(false)
    await manual.rollback()
    await outside
    expect((await driver.query('SELECT id FROM isolated ORDER BY id')).rows).toEqual([[2]])

    await Promise.all([
      driver.transaction!([
        { sql: 'INSERT INTO isolated VALUES (3)' },
        { sql: 'INSERT INTO isolated VALUES (4)' },
      ]),
      driver.transaction!([{ sql: 'INSERT INTO isolated VALUES (5)' }]),
    ])
    expect((await driver.query('SELECT id FROM isolated ORDER BY id')).rows).toEqual([
      [2],
      [3],
      [4],
      [5],
    ])
    await driver.close()
  })

  it('reports approxRows from sqlite_stat1 after ANALYZE, and omits it before', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE nums (id INTEGER PRIMARY KEY, v INTEGER)')
    for (let i = 0; i < 7; i++) await driver.query('INSERT INTO nums (v) VALUES (?)', [i])

    // No sqlite_stat1 table exists yet (never ANALYZEd) — omit rather than run COUNT(*).
    const before = await driver.tableSchema(undefined, 'nums')
    expect(before.approxRows).toBeUndefined()

    // ANALYZE populates sqlite_stat1; the first stat token is the row estimate.
    await driver.query('ANALYZE')
    const after = await driver.tableSchema(undefined, 'nums')
    expect(after.approxRows).toBe(7)

    await driver.close()
  })

  it('preserves 64-bit integers and serializes blobs without losing their type', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    const result = await driver.query(
      `SELECT 42 AS safe_int, 9007199254740993 AS wide_int, X'0102' AS payload`,
    )

    expect(result.rows[0]?.slice(0, 2)).toEqual([42, '9007199254740993'])
    expect(Buffer.isBuffer(result.rows[0]?.[2])).toBe(true)
    expect(JSON.parse(JSON.stringify(result.rows))[0][2]).toEqual({
      type: 'Buffer',
      data: [1, 2],
    })

    await driver.query(`CREATE TABLE wide_ids(value TEXT)`)
    const inserted = await driver.query(
      `INSERT INTO wide_ids(rowid, value) VALUES (9007199254740993, 'exact')`,
    )
    expect(inserted.lastInsertId).toBe('9007199254740993')
    await driver.close()
  })
})

describe('database service registry', () => {
  it('browses a bounded table page through the structured driver port', async () => {
    const service = newService()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    await service.query('u', conn.id, 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)')
    for (let index = 0; index < 5; index++) {
      await service.query('u', conn.id, 'INSERT INTO items (label) VALUES (?)', [`item-${index}`])
    }
    const page = await service.browse('u', conn.id, {
      table: 'items',
      limit: 2,
      offset: 2,
    })
    expect(page?.result.columns.map((column) => column.name)).toEqual(['id', 'label'])
    expect(page?.result.rows).toEqual([
      [3, 'item-2'],
      [4, 'item-3'],
    ])
    expect(
      await service.browse('other', conn.id, { table: 'items', limit: 2, offset: 0 }),
    ).toBeNull()
    await service.closeAll()
  })

  it('executeBatch applies statements atomically and blocks on a read-only connection', async () => {
    const service = newService()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    await service.query('u', conn.id, 'CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)')

    const res = await service.executeBatch('u', conn.id, [
      { sql: 'INSERT INTO t (v) VALUES (?)', params: [10] },
      { sql: 'UPDATE t SET v = ? WHERE v = ?', params: [11, 10] },
    ])
    expect(res?.results).toHaveLength(2)
    const rows = await service.query('u', conn.id, 'SELECT v FROM t')
    expect(rows?.result.rows).toEqual([[11]])

    // Unknown connection → null; other user → null (ownership).
    expect(await service.executeBatch('u', 'nope', [{ sql: 'SELECT 1' }])).toBeNull()
    expect(await service.executeBatch('other', conn.id, [{ sql: 'SELECT 1' }])).toBeNull()

    // A read-only connection rejects the write batch before the driver. (sqlite readonly
    // needs an existing file, so seed one first.)
    const roFile = path.join(dir, `ro-${Math.random().toString(36).slice(2)}.db`)
    const seed = createSqliteDriver({ file: roFile })
    await seed.query('CREATE TABLE x (id INTEGER)')
    await seed.close()
    const ro = await service.connect('u', {
      config: { dialect: 'sqlite', file: roFile, readonly: true },
    })
    expect(
      service.executeBatch('u', ro.id, [{ sql: 'INSERT INTO x VALUES (?)', params: [1] }]),
    ).rejects.toThrow()

    await service.closeAll()
  })

  it('scopes connections per user and gates by ownership', async () => {
    const service = newService()
    const conn = await service.connect('user-a', {
      config: { dialect: 'sqlite', file: ':memory:' },
    })
    expect(conn.name).toBe('In-memory SQLite')
    expect(conn.dialect).toBe('sqlite')
    expect(conn.connected).toBe(true)
    expect(await service.list('user-a')).toHaveLength(1)
    expect(await service.list('user-b')).toHaveLength(0)

    // user-b cannot touch user-a's connection.
    expect(await service.query('user-b', conn.id, 'SELECT 1')).toBeNull()

    const res = await service.query('user-a', conn.id, 'SELECT 1 AS n')
    expect(res?.result.rows).toEqual([[1]])

    await service.closeAll()
  })

  it('persists a connection across disconnect + a fresh service (survives restart)', async () => {
    const store = createConnectionStore({
      dir: path.join(dir, `persist-${Math.random().toString(36).slice(2)}`),
    })
    const memFile = path.join(dir, `persist-${Math.random().toString(36).slice(2)}.db`)
    const s1 = createDatabaseService({ store })
    const conn = await s1.connect('u', {
      config: { dialect: 'sqlite', file: memFile },
      name: 'My DB',
    })

    // Disconnect keeps the saved config (still listed, now disconnected).
    expect(await s1.disconnect('u', conn.id)).toBe(true)
    const afterDisconnect = await s1.list('u')
    expect(afterDisconnect).toHaveLength(1)
    expect(afterDisconnect[0].connected).toBe(false)
    expect(afterDisconnect[0].name).toBe('My DB')

    // A brand-new service (simulating a restart) still sees the saved connection,
    // disconnected, and can reconnect it.
    const s2 = createDatabaseService({ store })
    const listed = await s2.list('u')
    expect(listed).toHaveLength(1)
    expect(listed[0].connected).toBe(false)
    const reconnected = await s2.reconnect('u', conn.id)
    expect(reconnected?.connected).toBe(true)

    // remove forgets it entirely.
    expect(await s2.remove('u', conn.id)).toBe(true)
    expect(await s2.list('u')).toHaveLength(0)
    await s2.closeAll()
  })

  it('folds a re-connect to the same target onto its existing entry (no duplicates)', async () => {
    const service = newService()
    const memFile = path.join(dir, `dedup-${Math.random().toString(36).slice(2)}.db`)
    const first = await service.connect('u', {
      config: { dialect: 'sqlite', file: memFile },
      name: 'First',
    })
    // Same file again with a different label → reuses the same id, updates the label.
    const second = await service.connect('u', {
      config: { dialect: 'sqlite', file: memFile },
      name: 'Renamed',
    })
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('Renamed')
    expect(await service.list('u')).toHaveLength(1)
    // A different file is a distinct connection.
    await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    expect(await service.list('u')).toHaveLength(2)
    await service.closeAll()
  })

  it('renames a saved connection; unknown id returns null', async () => {
    const service = newService()
    const conn = await service.connect('u', {
      config: { dialect: 'sqlite', file: ':memory:' },
      name: 'Old',
    })
    const renamed = await service.rename('u', conn.id, 'New name')
    expect(renamed?.name).toBe('New name')
    expect((await service.list('u'))[0].name).toBe('New name')
    expect(await service.rename('u', 'does-not-exist', 'x')).toBeNull()
    await service.closeAll()
  })

  it('edits a saved connection config in place, keeping its id and repointing the live driver', async () => {
    const service = newService()
    const fileA = path.join(dir, `edit-a-${Math.random().toString(36).slice(2)}.db`)
    const fileB = path.join(dir, `edit-b-${Math.random().toString(36).slice(2)}.db`)

    const conn = await service.connect('u', {
      config: { dialect: 'sqlite', file: fileA },
      name: 'Original',
    })
    // Seed a marker row in file A only, so we can prove which file the live driver hits.
    await service.query('u', conn.id, 'CREATE TABLE t (label TEXT)')
    await service.query('u', conn.id, "INSERT INTO t (label) VALUES ('from-a')")

    // getConfig returns the stored config (as-stored) for the edit form.
    const before = await service.getConfig('u', conn.id)
    expect(before).toEqual({ name: 'Original', config: { dialect: 'sqlite', file: fileA } })

    // Edit → point at file B + rename, keeping the SAME id.
    const updated = await service.updateConfig('u', conn.id, {
      name: 'Renamed',
      config: { dialect: 'sqlite', file: fileB },
    })
    expect(updated?.id).toBe(conn.id)
    expect(updated?.name).toBe('Renamed')
    expect(updated?.connected).toBe(true)
    expect(await service.list('u')).toHaveLength(1) // no duplicate entry

    // The live driver now queries file B — table `t` from file A must not exist there.
    expect(service.query('u', conn.id, 'SELECT label FROM t')).rejects.toThrow()
    await service.query('u', conn.id, 'CREATE TABLE t2 (v INTEGER)')
    const b = await service.query('u', conn.id, "SELECT name FROM sqlite_master WHERE name = 't2'")
    expect(b?.result.rows).toEqual([['t2']])

    // Ownership + unknown-id guards.
    expect(await service.getConfig('other', conn.id)).toBeNull()
    expect(
      await service.updateConfig('other', conn.id, {
        config: { dialect: 'sqlite', file: ':memory:' },
      }),
    ).toBeNull()
    expect(
      await service.updateConfig('u', 'does-not-exist', {
        config: { dialect: 'sqlite', file: ':memory:' },
      }),
    ).toBeNull()

    await service.closeAll()
  })

  it('rejects an invalid config on edit and leaves the saved connection untouched', async () => {
    const service = newService()
    const file = path.join(dir, `edit-reject-${Math.random().toString(36).slice(2)}.db`)
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file }, name: 'Keep' })

    // An unreachable postgres URL fails validation → the edit throws, config stays put.
    expect(
      service.updateConfig('u', conn.id, {
        config: { dialect: 'postgres', url: 'postgres://localhost:1/none' },
      }),
    ).rejects.toThrow()
    expect(await service.getConfig('u', conn.id)).toEqual({
      name: 'Keep',
      config: { dialect: 'sqlite', file },
    })

    await service.closeAll()
  }, 15000)

  it('blocks writes on a read-only connection but allows reads (server-side guard)', async () => {
    const service = newService()
    const file = path.join(dir, `readonly-${Math.random().toString(36).slice(2)}.db`)

    // Seed a row on a writable connection first.
    const rw = await service.connect('u', { config: { dialect: 'sqlite', file }, name: 'RW' })
    await service.query('u', rw.id, 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    await service.query('u', rw.id, "INSERT INTO t (v) VALUES ('keep')")
    await service.disconnect('u', rw.id)

    // Reconnect the SAME file marked read-only (folds onto the same saved entry).
    const ro = await service.connect('u', {
      config: { dialect: 'sqlite', file, readonly: true },
      name: 'RO',
    })
    expect(ro.readonly).toBe(true)
    expect((await service.list('u'))[0].readonly).toBe(true)

    // A SELECT runs fine.
    const sel = await service.query('u', ro.id, 'SELECT v FROM t')
    expect(sel?.result.rows).toEqual([['keep']])

    // A DELETE is rejected with the typed error and the row survives.
    expect(service.query('u', ro.id, 'DELETE FROM t')).rejects.toMatchObject({
      code: 'readonly_blocked',
    })
    // An INSERT is likewise blocked.
    expect(service.query('u', ro.id, "INSERT INTO t (v) VALUES ('sneak')")).rejects.toMatchObject({
      code: 'readonly_blocked',
    })
    // The guard did not touch the driver — the original row is still the only row.
    const after = await service.query('u', ro.id, 'SELECT COUNT(*) FROM t')
    expect(after?.result.rows).toEqual([[1]])

    await service.closeAll()
  })

  it('round-trips a color tag through save → DbConnectionInfo (metadata only)', async () => {
    const store = createConnectionStore({
      dir: path.join(dir, `color-${Math.random().toString(36).slice(2)}`),
    })
    const s1 = createDatabaseService({ store })

    // Color set at connect time surfaces on the returned info + the list.
    const conn = await s1.connect('u', {
      config: { dialect: 'sqlite', file: ':memory:' },
      name: 'Prod',
    })
    expect(conn.color).toBeUndefined()
    const withColor = await s1.updateConfig('u', conn.id, {
      config: { dialect: 'sqlite', file: ':memory:', color: 'red' },
    })
    expect(withColor?.color).toBe('red')
    expect((await s1.list('u'))[0].color).toBe('red')
    await s1.closeAll()

    // It persists across a fresh service (survives restart) and never leaks as a secret
    // (color is plain metadata on the saved config).
    const s2 = createDatabaseService({ store })
    expect((await s2.list('u'))[0].color).toBe('red')
    // Clearing it (omitting the field) drops the tag back to the neutral look.
    const cleared = await s2.updateConfig('u', conn.id, {
      config: { dialect: 'sqlite', file: ':memory:' },
    })
    expect(cleared?.color).toBeUndefined()
    await s2.closeAll()
  })

  it('manual transaction: begin routes queries into an open tx; rollback discards, commit persists', async () => {
    const service = newService()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    await service.query('u', conn.id, 'CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)')

    // No tx open yet.
    expect((await service.list('u'))[0].txOpen).toBe(false)

    // Begin → the connection reports the open tx.
    const begun = await service.beginTx('u', conn.id)
    expect(begun?.txOpen).toBe(true)
    expect((await service.list('u'))[0].txOpen).toBe(true)

    // A parameterized batch + read both route through the open tx (the read sees the
    // uncommitted rows instead of trying to start a nested/separate transaction).
    await service.executeBatch('u', conn.id, [
      { sql: 'INSERT INTO t (v) VALUES (?)', params: [42] },
      { sql: 'INSERT INTO t (v) VALUES (?)', params: [43] },
    ])
    const browsedInsideTx = await service.browse('u', conn.id, {
      table: 't',
      limit: 100,
      offset: 0,
      sort: { column: 'id', direction: 'asc' },
    })
    expect(browsedInsideTx?.result.rows).toEqual([
      [1, 42],
      [2, 43],
    ])
    const insideTx = await service.query('u', conn.id, 'SELECT v FROM t')
    expect(insideTx?.result.rows).toEqual([[42], [43]])

    // Rollback discards the write and closes the tx.
    const rolled = await service.rollbackTx('u', conn.id)
    expect(rolled?.txOpen).toBe(false)
    const afterRollback = await service.query('u', conn.id, 'SELECT COUNT(*) FROM t')
    expect(afterRollback?.result.rows).toEqual([[0]])

    // A second tx that COMMITs persists its write past the tx.
    await service.beginTx('u', conn.id)
    await service.query('u', conn.id, 'INSERT INTO t (v) VALUES (7)')
    const committed = await service.commitTx('u', conn.id)
    expect(committed?.txOpen).toBe(false)
    const afterCommit = await service.query('u', conn.id, 'SELECT v FROM t')
    expect(afterCommit?.result.rows).toEqual([[7]])

    // beginTx is idempotent (a second begin while open is a no-op, still one tx).
    await service.beginTx('u', conn.id)
    const twice = await service.beginTx('u', conn.id)
    expect(twice?.txOpen).toBe(true)
    await service.rollbackTx('u', conn.id)

    // Ownership + unknown-connection gates return null.
    expect(await service.beginTx('other', conn.id)).toBeNull()
    expect(await service.beginTx('u', 'nope')).toBeNull()

    await service.closeAll()
  })

  it('manual transaction: read-only connection blocks a write inside a tx; disconnect rolls back an open tx', async () => {
    const service = newService()
    // A read-only connection: a write inside an open tx is still refused (readonly_blocked).
    const roFile = path.join(dir, `ro-tx-${Math.random().toString(36).slice(2)}.db`)
    const seed = createSqliteDriver({ file: roFile })
    await seed.query('CREATE TABLE x (id INTEGER)')
    await seed.close()
    const ro = await service.connect('u', {
      config: { dialect: 'sqlite', file: roFile, readonly: true },
    })
    await service.beginTx('u', ro.id)
    expect(service.query('u', ro.id, 'INSERT INTO x VALUES (1)')).rejects.toThrow()
    // A pure read inside the tx is fine.
    const read = await service.query('u', ro.id, 'SELECT COUNT(*) FROM x')
    expect(read?.result.rows).toEqual([[0]])
    await service.rollbackTx('u', ro.id)

    // Disconnect while a tx is open rolls it back + drops the live driver (no persisted write).
    const rw = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    await service.query('u', rw.id, 'CREATE TABLE t (id INTEGER)')
    await service.beginTx('u', rw.id)
    await service.query('u', rw.id, 'INSERT INTO t VALUES (1)')
    expect(await service.disconnect('u', rw.id)).toBe(true)
    expect((await service.list('u')).find((c) => c.id === rw.id)?.connected).toBe(false)

    await service.closeAll()
  })

  it('rejects an unreachable postgres connection at connect time', async () => {
    const service = newService()
    // No server on this port → the eager SELECT 1 validation rejects.
    expect(
      service.connect('u', { config: { dialect: 'postgres', url: 'postgres://localhost:1/none' } }),
    ).rejects.toThrow()
  }, 15000)

  it('rejects an unreachable sql server connection at connect time', async () => {
    const service = newService()
    expect(
      service.connect('u', { config: { dialect: 'mssql', url: 'mssql://sa:x@localhost:1/none' } }),
    ).rejects.toThrow()
  }, 20000)
})

/**
 * A controllable in-memory driver: `SLEEP <ms>` runs a cancellable delay that honours
 * the AbortSignal; `THROW <token>` rejects with a raw error carrying that token/code;
 * anything else returns a single-cell row immediately (so the connect-time SELECT 1
 * validation passes instantly). Lets us exercise the query lifecycle without a real db.
 */
function makeFakeDriver(): DbDriver {
  return {
    getFlags: () => ({
      dialect: 'sqlite',
      // Load-bearing, not decoration: the service's read-only write guard is gated on
      // `flags.kind === 'sql'` (service.ts). A fake that omits `kind` reports `undefined`
      // here and silently routes every query down the NON-SQL path.
      kind: 'sql',
      supportsMultipleSchemas: false,
      supportsReturning: true,
      supportsCancel: true,
      defaultSchema: 'main',
    }),
    async query(sql, _params, signal) {
      if (signal?.aborted) throw signal.reason ?? new Error('Query was cancelled.')
      const throwM = /^THROW (.+)$/.exec(sql)
      if (throwM) throw Object.assign(new Error(throwM[1]), { code: throwM[1] })
      const sleepM = /^SLEEP (\d+)$/.exec(sql)
      if (sleepM) {
        const ms = Number(sleepM[1])
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, ms)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              reject(signal.reason ?? new Error('Query was cancelled.'))
            },
            { once: true },
          )
        })
        return { columns: [], rows: [], rowsAffected: 0, durationMs: ms }
      }
      return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }
    },
    async browse() {
      return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }
    },
    async schemas() {
      return {}
    },
    async tableSchema() {
      return { name: 'x', type: 'table', columns: [], primaryKey: [], foreignKeys: [], indexes: [] }
    },
    async close() {},
  }
}

describe('query lifecycle (timeout + cancel)', () => {
  const withFake = () =>
    createDatabaseService({
      store: createConnectionStore({
        dir: path.join(dir, `life-${Math.random().toString(36).slice(2)}`),
      }),
      createDriver: () => makeFakeDriver(),
    })

  it('times out a long-running query with a typed `timeout` error', async () => {
    const service = withFake()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    expect(service.query('u', conn.id, 'SLEEP 5000', [], { timeoutMs: 40 })).rejects.toMatchObject({
      code: 'timeout',
    })
    await service.closeAll()
  })

  it('cancel() aborts an in-flight query with a typed `cancelled` error', async () => {
    const service = withFake()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    const pending = service.query('u', conn.id, 'SLEEP 5000', [], { timeoutMs: 0 })
    // Let the query register itself as in-flight before we cancel.
    await turns()
    expect(service.cancel('u', conn.id)).toBe(1)
    expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    // Nothing left to cancel afterwards.
    expect(service.cancel('u', conn.id)).toBe(0)
    await service.closeAll()
  })

  it('respects a caller-provided AbortSignal', async () => {
    const service = withFake()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    const ac = new AbortController()
    const pending = service.query('u', conn.id, 'SLEEP 5000', [], {
      timeoutMs: 0,
      signal: ac.signal,
    })
    await turns()
    ac.abort()
    expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await service.closeAll()
  })

  it('maps a raw driver error thrown mid-query to a typed code', async () => {
    const service = withFake()
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    expect(service.query('u', conn.id, 'THROW ECONNREFUSED', [])).rejects.toMatchObject({
      code: 'host_unreachable',
    })
    await service.closeAll()
  })

  it('cancel() on an unknown connection is a no-op (returns 0)', () => {
    const service = withFake()
    expect(service.cancel('nobody', 'missing')).toBe(0)
  })

  it('ping() is true for a live connection and false (dropping it) for a dead one', async () => {
    // A driver whose SELECT 1 throws simulates a dropped connection.
    let healthy = true
    const service = createDatabaseService({
      store: createConnectionStore({
        dir: path.join(dir, `ping-${Math.random().toString(36).slice(2)}`),
      }),
      createDriver: () => {
        const d = makeFakeDriver()
        const q = d.query
        d.query = (sql, p, s) =>
          healthy ? q(sql, p, s) : Promise.reject(new Error('connection lost'))
        return d
      },
    })
    const conn = await service.connect('u', { config: { dialect: 'sqlite', file: ':memory:' } })
    expect(await service.ping('u', conn.id)).toBe(true)

    healthy = false
    expect(await service.ping('u', conn.id)).toBe(false)
    // The dead driver was dropped → the connection now reads as disconnected.
    expect((await service.list('u'))[0].connected).toBe(false)
    // ping on an unknown / already-dropped connection is false.
    expect(await service.ping('u', 'missing')).toBe(false)
    await service.closeAll()
  })

  it('sqlite guards the signal before running (best-effort cancel)', async () => {
    const driver = createSqliteDriver({ file: ':memory:' })
    expect(driver.getFlags().supportsCancel).toBe(false)
    expect(driver.query('SELECT 1', [], AbortSignal.abort())).rejects.toThrow()
    await driver.close()
  })
})

describe('postgres result shaping (.values() → positional rows)', () => {
  // postgres.js `.values()` yields a row-major array of positional cell arrays, decorated with
  // a `columns` sidecar; a DML statement decorates with `count`. We model both exactly.
  const valuesResult = (rows: unknown[][], columns: string[]) =>
    Object.assign([...rows], { columns: columns.map((name) => ({ name })) })

  it('preserves duplicate column names positionally (JOINs / re-aliased selects)', () => {
    // Regression: rows used to be re-keyed by column name (`row[c.name]`), which collapsed two
    // columns sharing a name to the LAST value — corrupting `SELECT 1 AS x, 2 AS x` (→ [[2,2]])
    // and every JOIN with same-named columns (a.id/b.id). `.values()` keeps them positional.
    const r = shapePgValuesResult(valuesResult([[1, 2]], ['x', 'x']), 0)
    expect(r.columns.map((c) => c.name)).toEqual(['x', 'x'])
    expect(r.rows).toEqual([[1, 2]]) // NOT [[2, 2]]

    const join = shapePgValuesResult(
      valuesResult([[1, 'a1', 2, 'b2']], ['id', 'name', 'id', 'name']),
      0,
    )
    expect(join.rows).toEqual([[1, 'a1', 2, 'b2']]) // both tables' columns intact
  })

  it('keeps column headers on an empty result and reports DML rowsAffected', () => {
    const empty = shapePgValuesResult(valuesResult([], ['a', 'b']), 0)
    expect(empty.columns.map((c) => c.name)).toEqual(['a', 'b'])
    expect(empty.rows).toEqual([])
    // A DML `.values()` result has no `columns` but carries `count`.
    const dml = shapePgValuesResult(Object.assign([], { count: 3 }), 0)
    expect(dml.columns).toEqual([])
    expect(dml.rowsAffected).toBe(3)
  })
})

describe('mssql pool config (encrypt default + URI parsing)', () => {
  const asObj = (c: ReturnType<typeof buildMssqlPoolConfig>) => c as Exclude<typeof c, string>

  it('defaults encrypt OFF when ssl is unset (so a host given by IP connects)', () => {
    // Regression: tedious defaults encrypt=true, and encrypting to an IP throws
    // "Setting the TLS ServerName to an IP address is not permitted" — so a plain
    // localhost/Docker/IP connection failed. Unset ssl must mean no TLS, like every
    // other network driver.
    const cfg = asObj(
      buildMssqlPoolConfig({
        host: '127.0.0.1',
        port: 1433,
        user: 'sa',
        password: 'pw',
        database: 'master',
      }),
    )
    expect(cfg.server).toBe('127.0.0.1')
    expect(cfg.port).toBe(1433)
    expect(cfg.user).toBe('sa')
    expect(cfg.password).toBe('pw')
    expect(cfg.database).toBe('master')
    expect(cfg.options?.encrypt).toBe(false)
    expect(cfg.options?.trustServerCertificate).toBeUndefined()
  })

  it('maps the ssl shape → encrypt / trustServerCertificate', () => {
    expect(asObj(buildMssqlPoolConfig({ host: 'h', ssl: true })).options?.encrypt).toBe(true)
    expect(asObj(buildMssqlPoolConfig({ host: 'h', ssl: false })).options?.encrypt).toBe(false)
    const trusted = asObj(buildMssqlPoolConfig({ host: 'h', ssl: { rejectUnauthorized: false } }))
    expect(trusted.options?.encrypt).toBe(true)
    expect(trusted.options?.trustServerCertificate).toBe(true)
  })

  it('parses a mssql:// URI into a config (the mssql client cannot parse it itself)', () => {
    // Regression: unlike postgres/mysql/redis/mongo, the mssql client does not understand a
    // `mssql://` URI, so a URL-mode connection failed with "config.server is required".
    const cfg = asObj(buildMssqlPoolConfig({ url: 'mssql://sa:secret@127.0.0.1:1433/master' }))
    expect(cfg.server).toBe('127.0.0.1')
    expect(cfg.port).toBe(1433)
    expect(cfg.user).toBe('sa')
    expect(cfg.password).toBe('secret')
    expect(cfg.database).toBe('master')
    expect(cfg.options?.encrypt).toBe(false)
  })

  it('honours encrypt/trust query params + percent-decodes URI credentials', () => {
    const cfg = asObj(
      buildMssqlPoolConfig({
        url: 'sqlserver://sa:p%40ss%3Aword@db.example.com:1433/mydb?encrypt=true&trustServerCertificate=true',
      }),
    )
    expect(cfg.server).toBe('db.example.com')
    expect(cfg.user).toBe('sa')
    expect(cfg.password).toBe('p@ss:word') // %40→@ %3A→:
    expect(cfg.options?.encrypt).toBe(true)
    expect(cfg.options?.trustServerCertificate).toBe(true)
  })

  it('passes an ADO connection string through verbatim (not a URI)', () => {
    const ado = 'Server=localhost,1433;Database=mydb;User Id=sa;Password=pw;Encrypt=false'
    expect(buildMssqlPoolConfig({ url: ado })).toBe(ado)
  })
})

describe('friendly dialect error mapping', () => {
  it('classifies common engine errors into a small typed vocabulary', () => {
    expect(mapDbError(new Error('password authentication failed for user "x"')).code).toBe(
      'auth_failed',
    )
    expect(mapDbError(Object.assign(new Error('nope'), { code: '28P01' })).code).toBe('auth_failed')
    expect(
      mapDbError(Object.assign(new Error('Access denied for user'), { code: '1045' })).code,
    ).toBe('auth_failed')
    expect(
      mapDbError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })).code,
    ).toBe('host_unreachable')
    expect(mapDbError(new Error('getaddrinfo ENOTFOUND db.example')).code).toBe('host_unreachable')
    expect(mapDbError(new Error('syntax error at or near "slect"')).code).toBe('syntax_error')
    expect(mapDbError(Object.assign(new Error('Incorrect syntax near'), {})).code).toBe(
      'syntax_error',
    )
    expect(mapDbError(Object.assign(new Error('Cancelled.'), { code: 'ECANCEL' })).code).toBe(
      'cancelled',
    )
    expect(
      mapDbError(
        Object.assign(new Error('canceling statement due to user request'), { code: '57014' }),
      ).code,
    ).toBe('cancelled')
    expect(mapDbError(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' })).code).toBe(
      'timeout',
    )
    expect(mapDbError(new Error('some unexpected failure')).code).toBe('query_failed')
  })

  it('classifies TLS/cert handshake failures as tls_failed (not auth/query)', () => {
    expect(
      mapDbError(
        Object.assign(new Error('self signed certificate in certificate chain'), {
          code: 'HANDSHAKE_SSL_ERROR',
        }),
      ).code,
    ).toBe('tls_failed')
    expect(mapDbError(new Error('unable to verify the first certificate')).code).toBe('tls_failed')
    expect(
      mapDbError(Object.assign(new Error('cert'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).code,
    ).toBe('tls_failed')
    expect(mapDbError(new Error('certificate has expired')).code).toBe('tls_failed')
    // The mssql SNI-to-IP restriction is a TLS handshake failure too.
    expect(
      mapDbError(new Error('Setting the TLS ServerName to an IP address is not permitted')).code,
    ).toBe('tls_failed')
    // A plain auth failure must NOT be swallowed by the TLS branch.
    expect(mapDbError(new Error('password authentication failed for user "x"')).code).toBe(
      'auth_failed',
    )
  })

  it('classifies mssql (tedious) socket/timeout codes correctly (ESOCKET is not a timeout)', () => {
    // Real shapes captured from a live SQL Server (mssql v11 / tedious):
    // A refused/unreachable host surfaces as an ESOCKET "Could not connect" — host_unreachable,
    // NOT timeout (ESOCKET is a generic socket-establishment failure, not a wall-clock timeout).
    expect(
      mapDbError(
        Object.assign(
          new Error('Failed to connect to 127.0.0.1:1999 - Could not connect (sequence)'),
          { code: 'ESOCKET' },
        ),
      ).code,
    ).toBe('host_unreachable')
    // Encrypting to a host given by IP fails at the TLS layer (Node rejects an IP as SNI
    // servername) — also an ESOCKET, but it must map to tls_failed, not timeout.
    expect(
      mapDbError(
        Object.assign(
          new Error(
            "Failed to connect to 127.0.0.1:1433 - The property 'options.servername' Setting the TLS ServerName to an IP address is not permitted.. Received '127.0.0.1'",
          ),
          { code: 'ESOCKET' },
        ),
      ).code,
    ).toBe('tls_failed')
    // A genuine mssql connect timeout uses tedious's ETIMEOUT (note: NOT the Node ETIMEDOUT).
    expect(
      mapDbError(
        Object.assign(new Error('Failed to connect to 10.255.255.1:1433 in 1500ms'), {
          code: 'ETIMEOUT',
        }),
      ).code,
    ).toBe('timeout')
  })

  it('is idempotent — an already-mapped DbError passes through', () => {
    const mapped = mapDbError(new Error('syntax error'))
    expect(mapDbError(mapped)).toBe(mapped)
  })

  it('exposes a friendly message distinct from the raw engine text', () => {
    const e = mapDbError(new Error('password authentication failed for user "x"'))
    expect(e.friendly).toContain('Authentication failed')
    expect(e.message).toContain('password authentication failed')
  })
})

describe('query abort semantics (resolved-but-aborted)', () => {
  // A fake driver whose query IGNORES the abort signal and RESOLVES anyway after a tick —
  // mirroring MySQL `KILL QUERY` making `SLEEP()` return a row instead of erroring, or a
  // statement finishing in the abort race window. The service must still surface the
  // timeout/cancel rather than return the (possibly partial) result.
  const fakeDriver = (): DbDriver => ({
    getFlags: () => ({
      dialect: 'mysql',
      kind: 'sql',
      supportsMultipleSchemas: false,
      supportsReturning: false,
      supportsCancel: true,
      defaultSchema: '',
    }),
    async query() {
      await turns()
      return { columns: [{ name: 'v' }], rows: [[1]], durationMs: 20 }
    },
    async browse() {
      return { columns: [], rows: [], durationMs: 0 }
    },
    async schemas() {
      return {}
    },
    async tableSchema() {
      return {
        schema: '',
        name: '',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }
    },
    async close() {},
  })

  const svcWithFake = () =>
    createDatabaseService({
      store: createConnectionStore({
        dir: path.join(dir, `store-fake-${Math.random().toString(36).slice(2)}`),
      }),
      createDriver: fakeDriver,
    })

  it('surfaces `timeout` even when the driver resolves the timed-out query', async () => {
    const svc = svcWithFake()
    const conn = await svc.connect('u', { config: { dialect: 'mysql', url: 'mysql://x' } })
    expect(svc.query('u', conn.id, 'SELECT SLEEP(5)', [], { timeoutMs: 1 })).rejects.toMatchObject({
      code: 'timeout',
    })
    await svc.closeAll()
  })

  it('surfaces `cancelled` when cancel() fires and the driver resolves anyway', async () => {
    const svc = svcWithFake()
    const conn = await svc.connect('u', { config: { dialect: 'mysql', url: 'mysql://x' } })
    const p = svc.query('u', conn.id, 'SELECT SLEEP(5)', [], { timeoutMs: 0 })
    svc.cancel('u', conn.id)
    expect(p).rejects.toMatchObject({ code: 'cancelled' })
    await svc.closeAll()
  })
})
