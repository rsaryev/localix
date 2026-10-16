import { describe, expect, it } from 'bun:test'
import { isReadOnlyMongoCommand as ro } from './mongo'

describe('isReadOnlyMongoCommand', () => {
  it('passes the reading methods', () => {
    expect(ro('db.users.find({})')).toBe(true)
    expect(ro('db.users.findOne({"_id":1})')).toBe(true)
    expect(ro('db.users.countDocuments({})')).toBe(true)
    expect(ro('db.users.distinct("age")')).toBe(true)
    expect(ro('users.find({})')).toBe(true)
  })

  it('passes an aggregate with no writing stage', () => {
    expect(
      ro('db.users.aggregate([{"$match":{"age":{"$gt":20}}},{"$group":{"_id":"$city"}}])'),
    ).toBe(true)
    expect(
      ro('db.users.aggregate([{"$match":{"serial":{"$numberLong":"9223372036854775807"}}}])'),
    ).toBe(true)
  })

  it('blocks an aggregate that writes — the one write this grammar allows', () => {
    expect(ro('db.users.aggregate([{"$match":{}},{"$out":"copy"}])')).toBe(false)
    expect(ro('db.users.aggregate([{"$merge":{"into":"target","whenMatched":"replace"}}])')).toBe(
      false,
    )
  })
  it('does not mistake literal data or options for an executable write stage', () => {
    expect(ro('db.users.aggregate([{"$documents":[{"$out":"literal"}]}])')).toBe(true)
    expect(ro('db.users.aggregate([], {"comment":{"$merge":"literal"}})')).toBe(true)
  })

  it('fails safe on unparseable input and unsupported methods', () => {
    expect(ro('db.users.insertOne({"a":1})')).toBe(false)
    expect(ro('db.users.deleteMany({})')).toBe(false)
    expect(ro('db.users.drop()')).toBe(false)
    expect(ro('not a command')).toBe(false)
    expect(ro('')).toBe(false)
  })
})
