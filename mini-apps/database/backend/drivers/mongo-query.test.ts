import { describe, expect, it } from 'bun:test'
import { Binary, Decimal128, Long, ObjectId } from 'mongodb'
import { desugarMongo, parseMongoCommand, shapeMongoResult, splitTopLevelArgs } from './mongo-query'
import { boundedFindLimit, buildMongoFindOptions } from './mongo'

describe('splitTopLevelArgs', () => {
  it('splits top-level commas, respecting nesting and strings', () => {
    expect(splitTopLevelArgs('{"a":1}, {"b":0}')).toEqual(['{"a":1}', '{"b":0}'])
    expect(splitTopLevelArgs('[{"$match":{"x":1}}, {"$limit":5}]')).toEqual([
      '[{"$match":{"x":1}}, {"$limit":5}]',
    ])
    expect(splitTopLevelArgs('"a,b", 2')).toEqual(['"a,b"', '2'])
    expect(splitTopLevelArgs('   ')).toEqual([])
  })
})

describe('parseMongoCommand', () => {
  it('parses find with a filter', () => {
    expect(parseMongoCommand('db.users.find({"age":{"$gt":20}})')).toEqual({
      collection: 'users',
      method: 'find',
      args: [{ age: { $gt: 20 } }],
    })
  })
  it('accepts an omitted db. prefix and trailing semicolon', () => {
    expect(parseMongoCommand('orders.aggregate([{"$match":{"x":1}}]);')).toEqual({
      collection: 'orders',
      method: 'aggregate',
      args: [[{ $match: { x: 1 } }]],
    })
  })
  it('parses find(filter, projection)', () => {
    const cmd = parseMongoCommand('db.u.find({"a":1}, {"a":1,"_id":0})')
    expect(cmd.args).toEqual([{ a: 1 }, { a: 1, _id: 0 }])
  })
  it('parses a no-arg call', () => {
    expect(parseMongoCommand('db.c.countDocuments()').args).toEqual([])
  })
  it('rejects a malformed call, an unknown method, and bad JSON', () => {
    expect(() => parseMongoCommand('not a query')).toThrow()
    expect(() => parseMongoCommand('db.c.drop()')).toThrow(/Unsupported/)
    expect(() => parseMongoCommand('db.c.find({age: 20})')).toThrow(/valid JSON/) // unquoted key
  })
  it('validates each supported method instead of silently ignoring arguments', () => {
    expect(() => parseMongoCommand('db.c.find([], {})')).toThrow(/filter/)
    expect(() => parseMongoCommand('db.c.find({}, {}, {}, {})')).toThrow(/three/)
    expect(() => parseMongoCommand('db.c.find({}, {}, {"limit":1.5})')).toThrow(/safe integer/)
    expect(() => parseMongoCommand('db.c.aggregate({})')).toThrow(/pipeline/)
    expect(() => parseMongoCommand('db.c.aggregate([], {}, {})')).toThrow(/two/)
    expect(() => parseMongoCommand('db.c.countDocuments({}, [])')).toThrow(/options/)
    expect(() => parseMongoCommand('db.c.distinct()')).toThrow(/field string/)
    expect(() => parseMongoCommand('db.c.distinct(1)')).toThrow(/field string/)
  })
  it('accepts the documented projection and options argument positions', () => {
    expect(
      parseMongoCommand('db.c.find({"active":true}, {"name":1}, {"sort":{"name":1},"limit":5})')
        .args,
    ).toEqual([{ active: true }, { name: 1 }, { sort: { name: 1 }, limit: 5 }])
    expect(parseMongoCommand('db.c.find({}, null, {"projection":{"name":1}})').args).toEqual([
      {},
      null,
      { projection: { name: 1 } },
    ])
    expect(parseMongoCommand('db.c.aggregate([], {"allowDiskUse":true})').args).toEqual([
      [],
      { allowDiskUse: true },
    ])
    expect(parseMongoCommand('db.c.distinct("name", {}, {"maxTimeMS":500})').args).toEqual([
      'name',
      {},
      { maxTimeMS: 500 },
    ])
  })
})

describe('desugarMongo + parse (ObjectId/ISODate sugar)', () => {
  it('rewrites ObjectId() into $oid extended-json', () => {
    expect(desugarMongo('ObjectId("507f1f77bcf86cd799439011")')).toBe(
      '{"$oid":"507f1f77bcf86cd799439011"}',
    )
  })
  it('rewrites ISODate() and new Date() into $date', () => {
    expect(desugarMongo('ISODate("2020-01-01")')).toBe('{"$date":"2020-01-01"}')
    expect(desugarMongo('new Date("2020-01-01")')).toBe('{"$date":"2020-01-01"}')
  })
  it('parses a find filtering by _id via ObjectId sugar', () => {
    const cmd = parseMongoCommand('db.users.find({"_id": ObjectId("507f1f77bcf86cd799439011")})')
    expect(cmd.args).toEqual([{ _id: new ObjectId('507f1f77bcf86cd799439011') }])
  })
  it('revives canonical Extended JSON without losing BSON type or precision', () => {
    const cmd = parseMongoCommand(
      'db.values.find({"long":{"$numberLong":"9223372036854775807"},"decimal":{"$numberDecimal":"1234567890.123456789"},"binary":{"$binary":{"base64":"AQIDBA==","subType":"80"}}})',
    )
    const filter = cmd.args[0] as Record<string, unknown>
    expect(filter.long).toBe(9223372036854775807n)
    expect(filter.decimal).toEqual(Decimal128.fromString('1234567890.123456789'))
    expect(filter.binary).toEqual(new Binary(Uint8Array.from([1, 2, 3, 4]), 0x80))
  })
})

describe('Mongo find options', () => {
  it('keeps a smaller requested limit and caps unbounded or excessive reads', () => {
    expect(boundedFindLimit(undefined)).toBe(1000)
    expect(boundedFindLimit(0)).toBe(1000)
    expect(boundedFindLimit(5)).toBe(5)
    expect(boundedFindLimit(-5)).toBe(-5)
    expect(boundedFindLimit(5000)).toBe(1000)
    expect(boundedFindLimit(-5000)).toBe(-1000)
  })
  it('gives the explicit projection precedence while null delegates to options', () => {
    expect(
      buildMongoFindOptions({ name: 1 }, { projection: { old: 1 }, sort: { name: 1 } }),
    ).toEqual({
      projection: { name: 1 },
      sort: { name: 1 },
    })
    expect(buildMongoFindOptions(null, { projection: { name: 1 } })).toEqual({
      projection: { name: 1 },
    })
  })
})

describe('shapeMongoResult', () => {
  it('array of docs → union columns (_id first), a row per doc', () => {
    const r = shapeMongoResult([
      { _id: 1, name: 'a' },
      { _id: 2, age: 30 },
    ])
    expect(r.columns.map((c) => c.name)).toEqual(['_id', 'name', 'age'])
    expect(r.rows).toEqual([
      [1, 'a', null],
      [2, null, 30],
    ])
  })
  it('nested values are JSON-encoded', () => {
    const r = shapeMongoResult([{ _id: 1, tags: ['x', 'y'] }])
    expect(r.rows).toEqual([[1, '["x","y"]']])
  })

  it('keeps scalar and nested bigint values JSON-safe without rounding', () => {
    const r = shapeMongoResult([
      {
        safe: 42n,
        wide: 9007199254740993n,
        nested: { wide: 9007199254740993n },
      },
    ])
    expect(r.rows).toEqual([[42, '9007199254740993', '{"wide":"9007199254740993"}']])
    expect(() => JSON.stringify(r)).not.toThrow()
  })
  it('preserves BSON identity as exact Extended JSON', () => {
    const r = shapeMongoResult([
      {
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        long: Long.fromString('9007199254740993'),
        decimal: Decimal128.fromString('12345678901234567890.1234'),
        binary: new Binary(Uint8Array.from([0x00, 0xff])),
        at: new Date('2026-07-25T00:00:00.000Z'),
        nested: { count: 2, id: new ObjectId('507f1f77bcf86cd799439012') },
      },
    ])
    expect(r.rows).toEqual([
      [
        '{"$oid":"507f1f77bcf86cd799439011"}',
        '9007199254740993',
        '{"$numberDecimal":"12345678901234567890.1234"}',
        '{"$binary":{"base64":"AP8=","subType":"00"}}',
        '{"$date":1784937600000}',
        '{"count":2,"id":{"$oid":"507f1f77bcf86cd799439012"}}',
      ],
    ])
  })
  it('array of scalars (distinct) → value rows', () => {
    expect(shapeMongoResult(['a', 'b']).rows).toEqual([['a'], ['b']])
  })
  it('keeps BSON values returned by distinct as scalar value rows', () => {
    const ids = [new ObjectId('507f1f77bcf86cd799439011'), new ObjectId('507f1f77bcf86cd799439012')]
    const r = shapeMongoResult(ids)

    expect(r.columns).toEqual([{ name: 'value' }])
    expect(r.rows).toEqual([
      ['{"$oid":"507f1f77bcf86cd799439011"}'],
      ['{"$oid":"507f1f77bcf86cd799439012"}'],
    ])
  })
  it('scalar (count) → one value cell', () => {
    expect(shapeMongoResult(42).rows).toEqual([[42]])
  })
  it('empty array → an _id column, no rows', () => {
    const r = shapeMongoResult([])
    expect(r.columns).toEqual([{ name: '_id' }])
    expect(r.rows).toEqual([])
  })
})
