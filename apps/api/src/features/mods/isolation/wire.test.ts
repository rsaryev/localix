import { expect, test } from 'bun:test'
import { WireError, decode, encode, type WireTable } from './wire'

/** What a value is after crossing the channel as JSON text: what a structured clone kept. */

const REF = '\u0000lx'

const table: WireTable = {
  keep: () => 1,
  idOfStandIn: () => undefined,
  standIn: () => () => 'stand-in',
  kept: () => () => 'kept',
}

const across = (value: unknown) => decode(JSON.parse(JSON.stringify(encode(value, table))), table)

test('undefined, non-finite numbers, bigints, dates, maps, sets and bytes come back as themselves', () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  const value = across({
    args: ['path', undefined, { a: undefined }],
    numbers: [Number.NaN, Infinity, -Infinity, 1.5],
    big: 12345678901234567890n,
    at: new Date(5),
    invalid: new Date(Number.NaN),
    placed: new Map<unknown, unknown>([
      ['a', true],
      [1, new Set(['x'])],
    ]),
    bytes,
    buffer: bytes.buffer,
    floats: new Float64Array([0.5]),
  }) as Record<string, unknown>
  expect(value.args).toEqual(['path', undefined, { a: undefined }])
  expect((value.args as unknown[]).length).toBe(3)
  expect(Object.hasOwn((value.args as object[])[2]!, 'a')).toBe(true)
  expect(value.numbers).toEqual([Number.NaN, Infinity, -Infinity, 1.5])
  expect(value.big).toBe(12345678901234567890n)
  expect((value.at as Date).getTime()).toBe(5)
  expect(Number.isNaN((value.invalid as Date).getTime())).toBe(true)
  expect(value.placed).toEqual(
    new Map<unknown, unknown>([
      ['a', true],
      [1, new Set(['x'])],
    ]),
  )
  expect(value.bytes).toEqual(bytes)
  expect(new Uint8Array(value.buffer as ArrayBuffer)).toEqual(bytes)
  expect(value.floats).toEqual(new Float64Array([0.5]))
})

test('an instance of another class crosses as its own fields; a symbol is refused', () => {
  class Point {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  }
  expect(across(new Point(1, 2))).toEqual({ x: 1, y: 2 })
  expect(() => encode({ s: Symbol('s') }, table)).toThrow(WireError)
})

test('a tag of a shape encode never makes is refused', () => {
  for (const forged of [
    { [REF]: { undefined: 1 } },
    { [REF]: { number: '5' } },
    { [REF]: { bigint: '1e3' } },
    { [REF]: { date: 'yesterday' } },
    { [REF]: { map: [[1]] } },
    { [REF]: { set: 'abc' } },
    { [REF]: { bytes: ['Function', 'AAAA'] } },
    { [REF]: { bytes: ['Uint8Array', 'not base64!'] } },
    { [REF]: { bytes: ['Float64Array', 'AAAA'] } },
  ])
    expect(() => decode(forged, table)).toThrow(WireError)
})
