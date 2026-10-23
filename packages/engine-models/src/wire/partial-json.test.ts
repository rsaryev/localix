import { describe, expect, test } from 'bun:test'

import { parseJsonLenient, parsePartialJson } from './partial-json'
import { parseToolInput, StreamingToolInput } from './tool-input'

describe('a JSON text still streaming', () => {
  test.each([
    ['{"path":"a","content":"he', { path: 'a', content: 'he' }],
    ['{"a":"x\\', { a: 'x' }],
    ['{"a":"\\u12', { a: '' }],
    ['{"a":"\\u1234', { a: '\u1234' }],
    ['{"a":"x\\\\', { a: 'x\\' }],
    ['{"a":"q\\"', { a: 'q"' }],
    ['{"a":tr', { a: true }],
    ['{"a":nul', { a: null }],
    ['{"a":1.', { a: 1 }],
    ['{"a":1e', { a: 1 }],
    ['{"a":-', {}],
    ['{"a":[1,2,', { a: [1, 2] }],
    ['{"a":1,', { a: 1 }],
    ['{"a', {}],
    ['{"a":', {}],
    ['{"a": "x", "b"', { a: 'x' }],
    ['{"a":{"b":[1,{"c":"d', { a: { b: [1, { c: 'd' }] } }],
    ['[', []],
    ['"abc', 'abc'],
  ])('%s stands as far as it has come', (text, expected) => {
    expect(parsePartialJson(text)).toEqual(expected)
  })

  test('nothing usable is undefined', () => {
    expect(parsePartialJson('')).toBeUndefined()
    expect(parsePartialJson('   ')).toBeUndefined()
    expect(parsePartialJson('x')).toBeUndefined()
  })

  test("a model's broken escapes and raw control characters are repaired", () => {
    expect(parsePartialJson('{"re":"\\d+","b":"line\nnext"}')).toEqual({
      re: '\\d+',
      b: 'line\nnext',
    })
    expect(parsePartialJson('{"re":"\\d+","b":"tab\there')).toEqual({ re: '\\d+', b: 'tab\there' })
    expect(parseJsonLenient('{"re":"\\w"}')).toEqual({ re: '\\w' })
    expect(() => parseJsonLenient('{"a":')).toThrow()
  })
})

describe('a tool input as it streams', () => {
  const content = Array.from({ length: 2_500 }, (_, i) => `line ${i}: "quoted" \\ ${i};`).join('\n')
  const full = JSON.stringify({ path: 'src/big.ts', content })

  test('reparses a long input a bounded number of times, and ends on the full parse', () => {
    const input = new StreamingToolInput()
    const seen = new Set<unknown>()
    // A frozen clock: only growth can make a reparse due.
    for (let i = 0; i < full.length; i += 20) seen.add(input.push(full.slice(i, i + 20), 0))
    // ~5,000 deltas; growth by a quarter each time is a few dozen parses, not thousands.
    expect(seen.size).toBeLessThan(60)
    expect(parseToolInput(full)).toEqual({ path: 'src/big.ts', content })
  })

  test('a moment passing reparses a slowly growing input', () => {
    const input = new StreamingToolInput()
    input.push('{"path":"a.ts","content":"', 0)
    expect(input.push('x', 10)).toEqual({ path: 'a.ts', content: '' })
    expect(input.push('y', 200)).toEqual({ path: 'a.ts', content: 'xy' })
  })

  test('a half-written literal keeps the arguments that last parsed', () => {
    const input = new StreamingToolInput()
    expect(input.push('{"limit":5', 0)).toEqual({ limit: 5 })
    expect(input.push(',"x":', 1_000)).toEqual({ limit: 5 })
  })
})
