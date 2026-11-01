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

  test('an error far down a long array is kept', () => {
    const items = rows(400).map((r, i) =>
      i === 300 ? { ...r, error: 'disk full on item 300' } : r,
    )
    const parsed = JSON.parse(jsonDigest(JSON.stringify({ items }))!.render('/p'))
    expect(JSON.stringify(parsed.errors)).toContain('disk full on item 300')
  })

  test('false, zero and empty error flags do not push out a real error', () => {
    const items = rows(300).map((r, i) =>
      i < 30 ? { ...r, isError: false } : i === 200 ? { ...r, error: 'real failure' } : r,
    )
    const parsed = JSON.parse(jsonDigest(JSON.stringify({ items }))!.render('/p'))
    expect(JSON.stringify(parsed.errors)).toContain('real failure')
    expect(JSON.stringify(parsed.errors)).not.toContain('isError')
  })

  test('a walk cut short on a pathological input says so', () => {
    const wide = Array.from({ length: 300_000 }, () => ({ a: 1 }))
    const parsed = JSON.parse(jsonDigest(JSON.stringify(wide))!.render('/p'))
    expect(parsed.errorScan).toContain('cut')
  })
})
