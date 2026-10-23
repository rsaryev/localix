import { describe, expect, it } from 'bun:test'
import { isReadOnlyForUnknownEngine, isReadOnlyInput } from './index'

describe('isReadOnlyInput', () => {
  it('routes each engine family to a classifier that speaks its language', () => {
    expect(isReadOnlyInput('sql', 'SELECT 1')).toBe(true)
    expect(isReadOnlyInput('sql', 'DROP TABLE t')).toBe(false)

    expect(isReadOnlyInput('kv', 'GET k')).toBe(true)
    expect(isReadOnlyInput('kv', 'SET k v')).toBe(false)

    expect(isReadOnlyInput('document', 'db.users.find({})')).toBe(true)
    expect(isReadOnlyInput('document', 'db.users.aggregate([{"$out":"copy"}])')).toBe(false)

    expect(isReadOnlyInput('search', 'products.search({})')).toBe(true)
    expect(isReadOnlyInput('search', 'products.index({})')).toBe(false)
  })

  it("does not classify one engine's input with another's rules", () => {
    // `SET k v` is a Redis write; as SQL it is not a read starter either. The point is the
    // registry never reaches for the SQL classifier on a kv connection.
    expect(isReadOnlyInput('kv', 'SELECT 1')).toBe(false)
    expect(isReadOnlyInput('sql', 'GET k')).toBe(false)
  })

  it('fails safe on an engine family with no classifier', () => {
    expect(isReadOnlyInput('brand-new-engine' as never, 'SELECT 1')).toBe(false)
  })
})

describe('isReadOnlyForUnknownEngine', () => {
  it('reads a proven read in any engine language — the ones the SQL-only rule refused', () => {
    for (const input of [
      'GET user:1',
      'SCAN 0 COUNT 50',
      'HGETALL session:9',
      'CONFIG GET maxmemory',
      'db.users.find({})',
      'users.countDocuments({})',
      'db.orders.aggregate([{"$match":{"total":{"$gt":5}}}])',
      'products.search({"query":{"match_all":{}}})',
      'products.count({})',
      'SELECT * FROM t',
    ]) {
      expect({ input, read: isReadOnlyForUnknownEngine(input) }).toEqual({ input, read: true })
    }
  })

  it('writes on anything no engine proves a read', () => {
    for (const input of [
      'SET k v',
      'FLUSHALL',
      'CONFIG SET dir /tmp',
      'db.users.aggregate([{"$out":"copy"}])',
      'db.users.deleteMany({})',
      'products.index({})',
      'DELETE FROM t',
      "SELECT nextval('s')",
      '',
      'something unrecognised',
    ]) {
      expect({ input, read: isReadOnlyForUnknownEngine(input) }).toEqual({ input, read: false })
    }
  })

  it("refuses a Redis read that is a SQL write in another engine's language", () => {
    // Postgres `CLUSTER info` rewrites the table `info`; as Redis it is a read. The engine
    // is unknown here, so the Redis verdict alone must not vouch for it.
    expect(isReadOnlyInput('kv', 'CLUSTER INFO')).toBe(true)
    expect(isReadOnlyForUnknownEngine('CLUSTER INFO')).toBe(false)
    expect(isReadOnlyForUnknownEngine('cluster nodes')).toBe(false)
  })
})
