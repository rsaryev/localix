/**
 * The read-only guard-rail at its enforcement point, for NON-SQL engines.
 *
 * `read-only/*.test.ts` proves each classifier in isolation; this proves the wiring —
 * that `runQuery` consults the classifier for the entry's engine family and refuses
 * BEFORE the driver is touched. It is the regression test for the hole this replaced:
 * the guard used to be gated on `flags.kind === 'sql'`, so a read-only Redis/Mongo/ES
 * connection silently accepted writes from the console route.
 */
import { describe, expect, it } from 'bun:test'
import type { DbDriver, DriverFlags, EngineKind } from '../drivers/port'
import type { LiveEntry } from './live-entry'
import { runBatch, runQuery } from './run-query'

/** A driver that records every statement that reaches it — the guard's job is to keep
 *  this list empty for a blocked write. */
function spyDriver() {
  const seen: string[] = []
  const driver = {
    async query(sql: string) {
      seen.push(sql)
      return { columns: [], rows: [], durationMs: 0 }
    },
    async close() {},
  } as unknown as DbDriver
  return { driver, seen }
}

function entry(kind: EngineKind, readonly: boolean) {
  const { driver, seen } = spyDriver()
  const live: LiveEntry = {
    driver,
    flags: { kind } as DriverFlags,
    readonly,
    serverReadOnly: false,
    inflight: new Map(),
    inflightOperations: new Set(),
    inflightMetadata: new Set(),
    closing: false,
    recentQueries: [],
  }
  return { live, seen }
}

describe('runQuery read-only guard, per engine family', () => {
  it('blocks a Redis write on a read-only connection without touching the driver', async () => {
    const { live, seen } = entry('kv', true)
    expect(runQuery(live, 'SET k v')).rejects.toMatchObject({ code: 'readonly_blocked' })
    expect(seen).toEqual([])
  })

  it('blocks the writes a keyspace-refresh whitelist would have called reads', async () => {
    const { live, seen } = entry('kv', true)
    // `CONFIG SET` changes no keys, so the UI's keyspace-refresh set treats it as a read.
    // The security question is a different one, and the guard must answer that one.
    expect(runQuery(live, 'CONFIG SET dir /tmp')).rejects.toMatchObject({
      code: 'readonly_blocked',
    })
    expect(seen).toEqual([])
  })

  it('blocks a Mongo aggregate that writes via $out', async () => {
    const { live, seen } = entry('document', true)
    expect(runQuery(live, 'db.users.aggregate([{"$out":"copy"}])')).rejects.toMatchObject({
      code: 'readonly_blocked',
    })
    expect(seen).toEqual([])
  })

  it('does not leave a teardown barrier behind when a read-only batch is rejected', async () => {
    const { live, seen } = entry('sql', true)
    expect(runBatch(live, [{ sql: 'UPDATE users SET active = 0' }])).rejects.toMatchObject({
      code: 'readonly_blocked',
    })
    expect(seen).toEqual([])
    expect(live.inflightOperations.size).toBe(0)
  })

  it('rejects a non-atomic batch before the driver can partially apply it', async () => {
    const { live, seen } = entry('sql', false)
    expect(
      runBatch(live, [
        { sql: 'UPDATE users SET active = 0' },
        { sql: 'UPDATE users SET active = 1' },
      ]),
    ).rejects.toMatchObject({ code: 'tx_unsupported' })
    expect(seen).toEqual([])
    expect(live.inflightOperations.size).toBe(0)
  })

  it('lets reads through on a read-only connection, for every family', async () => {
    for (const [kind, read] of [
      ['kv', 'GET k'],
      ['document', 'db.users.find({})'],
      ['search', 'products.search({})'],
      ['sql', 'SELECT 1'],
    ] as const) {
      const { live, seen } = entry(kind, true)
      await runQuery(live, read)
      expect(seen).toEqual([read])
    }
  })

  it('does not dispatch work for an already-aborted caller signal', async () => {
    const { live, seen } = entry('sql', false)
    expect(
      runQuery(live, 'UPDATE users SET active = 0', undefined, {
        timeoutMs: 0,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(seen).toEqual([])
    expect(live.inflight.size).toBe(0)
  })

  it('leaves a writable connection alone', async () => {
    const { live, seen } = entry('sql', false)
    await runQuery(live, "SELECT * FROM users WHERE email = 'private@example.com' AND id = 42")
    expect(seen).toEqual(["SELECT * FROM users WHERE email = 'private@example.com' AND id = 42"])
    expect(live.recentQueries).toEqual(["SELECT * FROM users WHERE email = '…' AND id = ?"])
  })
})
