import { describe, expect, it } from 'bun:test'
import {
  abbreviateRedisType,
  decodeRedisBytes,
  parseRedisCommand,
  REDIS_SCAN_MAX_ROUNDS,
  scanRedisPage,
  shapeRedisPairs,
  shapeRedisReply,
} from './redis-protocol'

describe('abbreviateRedisType', () => {
  it('shortens string, passes through container types, empties none/unknown', () => {
    expect(abbreviateRedisType('string')).toBe('str')
    expect(abbreviateRedisType('hash')).toBe('hash')
    expect(abbreviateRedisType('zset')).toBe('zset')
    expect(abbreviateRedisType('none')).toBe('')
    expect(abbreviateRedisType('whatever')).toBe('')
  })
})

describe('parseRedisCommand', () => {
  it('splits on whitespace', () => {
    expect(parseRedisCommand('GET foo')).toEqual(['GET', 'foo'])
    expect(parseRedisCommand('  KEYS   *  ')).toEqual(['KEYS', '*'])
  })

  it('honours double and single quotes as one argument', () => {
    expect(parseRedisCommand('SET greeting "hello world"')).toEqual([
      'SET',
      'greeting',
      'hello world',
    ])
    expect(parseRedisCommand("SET k 'a b c'")).toEqual(['SET', 'k', 'a b c'])
  })

  it('keeps an empty quoted argument', () => {
    expect(parseRedisCommand('SET k ""')).toEqual(['SET', 'k', ''])
  })

  it('unescapes a backslash inside quotes', () => {
    expect(parseRedisCommand('SET k "a\\"b"')).toEqual(['SET', 'k', 'a"b'])
  })

  it('returns [] for a blank line', () => {
    expect(parseRedisCommand('   ')).toEqual([])
  })

  it('rejects an unterminated quote instead of executing a truncated argument', () => {
    expect(() => parseRedisCommand('SET key "unfinished')).toThrow(/Unterminated/)
    expect(() => parseRedisCommand("SET key 'unfinished")).toThrow(/Unterminated/)
  })
})

describe('shapeRedisReply', () => {
  it('nil → a single NULL value cell', () => {
    expect(shapeRedisReply(null)).toEqual({
      columns: [{ name: 'value' }],
      rows: [[null]],
      durationMs: 0,
    })
  })

  it('scalar → one value row', () => {
    expect(shapeRedisReply('OK').rows).toEqual([['OK']])
    expect(shapeRedisReply(42).rows).toEqual([[42]])
  })

  it('keeps binary bytes distinguishable while decoding ordinary Redis text', () => {
    expect(decodeRedisBytes(Uint8Array.from([0x68, 0x69]))).toBe('hi')
    expect(decodeRedisBytes(Uint8Array.from([0x00, 0xff]))).toEqual(Buffer.from([0x00, 0xff]))
    expect(shapeRedisReply(Uint8Array.from([0x00, 0xff])).rows).toEqual([
      [Buffer.from([0x00, 0xff])],
    ])
  })

  it('flat array → one value column, a row per element', () => {
    const r = shapeRedisReply(['a', 'b', 'c'])
    expect(r.columns).toEqual([{ name: 'value' }])
    expect(r.rows).toEqual([['a'], ['b'], ['c']])
  })

  it('nested array element is JSON-encoded', () => {
    const r = shapeRedisReply([['x', 1], 'y'])
    expect(r.rows).toEqual([['["x",1]'], ['y']])
  })

  it('keeps scalar and nested bigint replies JSON-safe without rounding', () => {
    expect(shapeRedisReply([42n, 9007199254740993n, { n: 9007199254740993n }]).rows).toEqual([
      [42],
      ['9007199254740993'],
      ['{"n":"9007199254740993"}'],
    ])
  })

  it('normalizes paired bigint and nested values through the same exact cell serializer', () => {
    expect(
      shapeRedisPairs(
        ['wide', 9007199254740993n, 'nested', { n: 9007199254740993n }],
        ['field', 'value'],
      ).rows,
    ).toEqual([
      ['wide', '9007199254740993'],
      ['nested', '{"n":"9007199254740993"}'],
    ])
  })

  it('rejects an incomplete pair instead of dropping its final value', () => {
    expect(() => shapeRedisPairs(['field', 'value', 'orphan'], ['field', 'value'])).toThrow(
      /contained 3 values/,
    )
  })

  it('object (HGETALL) → field/value pairs', () => {
    const r = shapeRedisReply({ name: 'ann', age: '30' })
    expect(r.columns).toEqual([{ name: 'field' }, { name: 'value' }])
    expect(r.rows).toEqual([
      ['name', 'ann'],
      ['age', '30'],
    ])
  })

  it('carries the caller-supplied durationMs', () => {
    expect(shapeRedisReply('OK', 12).durationMs).toBe(12)
  })
})

describe('structured Redis paging', () => {
  it('follows cursor pages until an offset hash page is filled', async () => {
    const replies = [
      ['7', ['a', '1', 'b', '2']],
      ['9', ['c', '3']],
      ['0', ['d', '4', 'e', '5']],
    ] as Array<[string, string[]]>
    const values = await scanRedisPage(async () => replies.shift()!, 'HSCAN', 'hash', 2, 2)
    expect(values).toEqual(['c', '3', 'd', '4'])
    expect(shapeRedisPairs(values, ['field', 'value']).rows).toEqual([
      ['c', '3'],
      ['d', '4'],
    ])
  })

  it('pages scalar set members and stops when the cursor completes', async () => {
    const replies = [
      ['2', ['a', 'b']],
      ['0', ['c']],
    ] as Array<[string, string[]]>
    const values = await scanRedisPage(async () => replies.shift()!, 'SSCAN', 'set', 1, 5)
    expect(values).toEqual(['b', 'c'])
  })

  it('does not let duplicate SCAN elements consume page positions', async () => {
    const hashReplies = [
      ['2', ['a', '1', 'b', '2']],
      ['3', ['a', '1', 'c', '3']],
      ['0', ['d', '4']],
    ] as Array<[string, string[]]>
    expect(await scanRedisPage(async () => hashReplies.shift()!, 'HSCAN', 'hash', 2, 2)).toEqual([
      'c',
      '3',
      'd',
      '4',
    ])

    const setReplies = [
      ['2', ['a', 'b']],
      ['0', ['a', 'c']],
    ] as Array<[string, string[]]>
    expect(await scanRedisPage(async () => setReplies.shift()!, 'SSCAN', 'set', 1, 2)).toEqual([
      'b',
      'c',
    ])
  })

  it('fails a browse after bounded empty cursor pages instead of waiting forever', async () => {
    let calls = 0
    expect(
      scanRedisPage(
        async () => [String(++calls), []],
        'SSCAN',
        'set',
        REDIS_SCAN_MAX_ROUNDS + 1,
        1,
      ),
    ).rejects.toThrow(`exceeded the ${REDIS_SCAN_MAX_ROUNDS}-round browse limit`)
    expect(calls).toBe(REDIS_SCAN_MAX_ROUNDS)
  })

  it('rejects malformed cursor and hash-pair responses instead of returning partial data', async () => {
    expect(scanRedisPage(async () => 'wrong', 'SSCAN', 'set', 0, 1)).rejects.toThrow(
      /invalid cursor response/,
    )
    expect(scanRedisPage(async () => ['0', ['field']], 'HSCAN', 'hash', 0, 1)).rejects.toThrow(
      /incomplete field\/value pair/,
    )
  })
})
