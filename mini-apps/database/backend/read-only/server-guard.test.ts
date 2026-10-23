import { describe, expect, test } from 'bun:test'

import { DATABASE_DIALECTS } from '../../shared/driver-catalog'
import {
  NO_SERVER_READ_ONLY,
  SERVER_READ_ONLY_STATEMENT,
  applyServerReadOnly,
} from './server-guard'

/**
 * A read-only connection asked the SERVER to enforce it.
 *
 * Until this layer, the only guard was the text classifier in `../index` — whose own header
 * says "It is NOT a security boundary … it exists to stop *accidental* writes" — while
 * `run-query.ts` calls that check the "primary enforcement point". An independent review
 * measured ten side-effecting statements it calls read-only: `SELECT nextval(…)`,
 * `setval`, `lo_unlink`, `dblink_exec`, `pg_terminate_backend`, `pg_sleep`, a volatile UDF
 * and more, because `WRITE_KEYWORDS` catches `CALL`/`EXECUTE` but not a function call. No
 * regex can decide this, so the engine is asked instead.
 */
describe('server-enforced read-only', () => {
  test('every dialect is accounted for — supported or explicitly not', () => {
    // The point of listing the gap: an engine added later must land in one bucket
    // deliberately, rather than silently inheriting "classifier only".
    const supported = Object.keys(SERVER_READ_ONLY_STATEMENT)
    const covered = new Set([...supported, ...NO_SERVER_READ_ONLY])
    expect([...DATABASE_DIALECTS].filter((d) => !covered.has(d))).toEqual([])
    // And no dialect claims both.
    expect(supported.filter((d) => NO_SERVER_READ_ONLY.includes(d as never))).toEqual([])
  })

  test('the statements are the session-scoped forms, not per-transaction', () => {
    // A bare `SET TRANSACTION READ ONLY` applies to a transaction a plain statement never
    // enters, so it would silently do nothing. These are the session-scoped forms.
    expect(SERVER_READ_ONLY_STATEMENT.postgres).toBe(
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY',
    )
    expect(SERVER_READ_ONLY_STATEMENT.mysql).toBe('SET SESSION TRANSACTION READ ONLY')
    // SQLite's real equivalent — rejects writes including from a trigger.
    expect(SERVER_READ_ONLY_STATEMENT.sqlite).toBe('PRAGMA query_only = 1')
  })

  test('a supported engine is asked exactly once, with its own statement', async () => {
    const ran: string[] = []
    const outcome = await applyServerReadOnly('postgres', async (sql) => {
      ran.push(sql)
    })
    expect(outcome).toEqual({ enforced: true })
    expect(ran).toEqual(['SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'])
  })

  test('an unsupported engine is not asked at all, and says so', async () => {
    for (const dialect of NO_SERVER_READ_ONLY) {
      const ran: string[] = []
      const outcome = await applyServerReadOnly(dialect, async (sql) => {
        ran.push(sql)
      })
      expect({ dialect, outcome }).toEqual({
        dialect,
        outcome: { enforced: false, reason: 'unsupported' },
      })
      // Reporting `unsupported` rather than a success the engine never gave is the whole
      // point — a caller can tell the two apart.
      expect(ran).toEqual([])
    }
  })

  test('a rejection is reported, never thrown — the connection still works', async () => {
    // Turning "your server would not take a hint" into "you cannot connect" would be a
    // worse outcome than the status quo, and the classifier guards the path either way.
    const outcome = await applyServerReadOnly('mysql', async () => {
      throw new Error('Access denied for SET SESSION')
    })
    expect(outcome).toEqual({
      enforced: false,
      reason: 'rejected',
      error: 'Access denied for SET SESSION',
    })
  })

  test('a non-Error rejection still yields a readable reason', async () => {
    const outcome = await applyServerReadOnly('sqlite', async () => {
      throw 'locked'
    })
    expect(outcome).toMatchObject({ enforced: false, reason: 'rejected', error: 'locked' })
  })
})

describe('the read-only promise is legible, not just enforced', () => {
  test('a connected read-only connection reports WHICH guarantee it got', async () => {
    const { infoFrom } = await import('../service/live-entry')
    const saved = {
      id: 'c1',
      name: 'prod',
      createdAt: 0,
      config: { dialect: 'postgres', readonly: true },
    } as never
    const live = (serverReadOnly: boolean) =>
      ({ flags: undefined, serverReadOnly, activeTx: undefined }) as never

    // "read-only" is two different promises and the user marking a PRODUCTION connection
    // deserves to know which: the engine refusing writes outright, or a statement classifier
    // that cannot see a write wearing a SELECT.
    expect(infoFrom(saved, live(true))).toMatchObject({ readonly: true, serverReadOnly: true })
    expect(infoFrom(saved, live(false))).toMatchObject({ readonly: true, serverReadOnly: false })
  })

  test('disconnected omits it rather than reporting false', async () => {
    // There is no session to have asked yet; `false` would read as "the engine refused".
    const { infoFrom } = await import('../service/live-entry')
    const saved = {
      id: 'c1',
      name: 'prod',
      createdAt: 0,
      config: { dialect: 'postgres', readonly: true },
    } as never
    const info = infoFrom(saved, undefined)
    expect(info.readonly).toBe(true)
    expect('serverReadOnly' in info).toBe(false)
  })

  test('a writable connection never carries the field at all', async () => {
    const { infoFrom } = await import('../service/live-entry')
    const saved = { id: 'c2', name: 'dev', createdAt: 0, config: { dialect: 'postgres' } } as never
    const info = infoFrom(saved, { flags: undefined, serverReadOnly: false } as never)
    expect(info.readonly).toBe(false)
    expect('serverReadOnly' in info).toBe(false)
  })
})
