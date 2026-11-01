import { describe, expect, test } from 'bun:test'

import { jsonDigest } from './json-digest'
import { textEncoderByteLength } from './hash'

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `row ${i}`, note: 'x'.repeat(100) }))

describe('jsonDigest', () => {
  test('a large JSON result becomes shape, array lengths, preview and the path', () => {
    const text = JSON.stringify({ total: 2000, items: rows(2000) })
    const d = jsonDigest(text)!
    const out = d.render('/tmp/spill.json')
    const parsed = JSON.parse(out)
    expect(parsed.path).toBe('/tmp/spill.json')
    expect(parsed.bytes).toBe(textEncoderByteLength(text))
    expect(parsed.shape.fields.items.array).toBe(2000)
    expect(parsed.shape.fields.items.items.fields.id).toBe('number')
    expect(JSON.stringify(parsed.preview)).toContain('row 0')
    expect(out).not.toContain('row 1999')
    expect(textEncoderByteLength(out)).toBeLessThan(textEncoderByteLength(text) / 10)
  })

  test('the saved file holds the whole value', () => {
    const value = { items: rows(500) }
    const d = jsonDigest(JSON.stringify(value))!
    expect(JSON.parse(d.file)).toEqual(value)
  })

  test('error fields stay whole, even deep in the result', () => {
    const reason = 'connection refused: '.repeat(40)
    const text = JSON.stringify({ items: rows(1500), meta: { error: { message: reason } } })
    const parsed = JSON.parse(jsonDigest(text)!.render('/p'))
    expect(JSON.stringify(parsed.errors)).toContain(reason)
  })

  test('items of different shapes merge into one item shape', () => {
    const text = JSON.stringify(
      Array.from({ length: 1000 }, (_, i) => (i % 2 ? { a: 1, pad: 'p'.repeat(50) } : { b: 'x' })),
    )
    const shape = JSON.parse(jsonDigest(text)!.render('/p')).shape
    expect(Object.keys(shape.items.fields).sort()).toEqual(['a', 'b', 'pad'])
  })

  test('non-JSON, scalars and results the digest cannot shrink are left alone', () => {
    expect(jsonDigest('plain text '.repeat(5000))).toBeUndefined()
    expect(jsonDigest(JSON.stringify('s'.repeat(50_000)))).toBeUndefined()
    expect(jsonDigest(JSON.stringify([1, 2, 3]))).toBeUndefined()
  })
})
