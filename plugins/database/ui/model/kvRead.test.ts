import { describe, expect, it } from 'bun:test'
import { parseRedisType, quoteRedisKey, readCommandForType, redisTouchesKeyspace } from './kvRead'

describe('redisTouchesKeyspace', () => {
  it('is false for pure reads', () => {
    expect(redisTouchesKeyspace('GET foo')).toBe(false)
    expect(redisTouchesKeyspace('hgetall cart')).toBe(false)
    expect(redisTouchesKeyspace('KEYS *')).toBe(false)
    expect(redisTouchesKeyspace('')).toBe(false)
  })
  it('is true for writes / unknown commands', () => {
    expect(redisTouchesKeyspace('SET a 1')).toBe(true)
    expect(redisTouchesKeyspace('del a')).toBe(true)
    expect(redisTouchesKeyspace('HSET h f v')).toBe(true)
    expect(redisTouchesKeyspace('FLUSHDB')).toBe(true)
  })
})

describe('parseRedisType', () => {
  it('normalizes known types (case/space insensitive)', () => {
    expect(parseRedisType('string')).toBe('string')
    expect(parseRedisType(' HASH ')).toBe('hash')
    expect(parseRedisType('ZSet')).toBe('zset')
  })
  it('falls back to none for unknown/empty', () => {
    expect(parseRedisType('')).toBe('none')
    expect(parseRedisType(null)).toBe('none')
    expect(parseRedisType('weird')).toBe('none')
  })
})

describe('quoteRedisKey', () => {
  it('quotes and escapes', () => {
    expect(quoteRedisKey('user:1')).toBe('"user:1"')
    expect(quoteRedisKey('a "b" c')).toBe('"a \\"b\\" c"')
  })
})

describe('readCommandForType', () => {
  it('picks the whole-value read per type', () => {
    expect(readCommandForType('string', 'k')).toBe('GET "k"')
    expect(readCommandForType('list', 'k')).toBe('LRANGE "k" 0 -1')
    expect(readCommandForType('set', 'k')).toBe('SMEMBERS "k"')
    expect(readCommandForType('zset', 'k')).toBe('ZRANGE "k" 0 -1 WITHSCORES')
    expect(readCommandForType('hash', 'k')).toBe('HGETALL "k"')
    expect(readCommandForType('stream', 'k')).toBe('XRANGE "k" - +')
    expect(readCommandForType('none', 'k')).toBe('GET "k"')
  })
})
