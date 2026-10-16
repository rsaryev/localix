import { describe, expect, test } from 'bun:test'
import { crushJsonArray } from './json'

describe('crushJsonArray', () => {
  test('hoists constant fields and caps rows for a long homogeneous array', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      host: 'prod-1',
      region: 'us-east',
      cpu: i,
      id: `r${i}`,
    }))
    const text = JSON.stringify(rows)
    const r = crushJsonArray(text, { maxItems: 15 })
    expect(r).not.toBeNull()
    expect(r!.totalItems).toBe(100)
    expect(r!.afterChars).toBeLessThan(r!.beforeChars)
    const parsed = JSON.parse(r!.text)
    // Constant fields hoisted once, not repeated per row.
    expect(parsed.__constants).toEqual({ host: 'prod-1', region: 'us-east' })
    expect(parsed.__crushed_from).toBe(100)
    // Kept rows no longer carry the constant fields.
    expect(parsed.items[0]).not.toHaveProperty('host')
    expect(parsed.items[0]).toHaveProperty('cpu')
  })

  test('finds the dominant array inside a wrapper object', () => {
    const text = JSON.stringify({
      query: 'x',
      results: Array.from({ length: 20 }, (_, i) => ({ path: `a/${i}.ts`, score: 1 })),
    })
    const r = crushJsonArray(text)
    expect(r).not.toBeNull()
    expect(r!.totalItems).toBe(20)
    expect(JSON.parse(r!.text).__constants).toEqual({ score: 1 })
  })

  test('returns null for non-JSON, short arrays, and non-object arrays', () => {
    expect(crushJsonArray('not json at all')).toBeNull()
    expect(crushJsonArray(JSON.stringify([{ a: 1 }, { a: 2 }]))).toBeNull() // < 4 rows
    expect(crushJsonArray(JSON.stringify([1, 2, 3, 4, 5]))).toBeNull() // not objects
  })

  test('returns null when crushing would not shrink the text', () => {
    // 4 tiny rows, all distinct, no constants → wrapping overhead exceeds savings.
    const text = JSON.stringify([{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }])
    expect(crushJsonArray(text)).toBeNull()
  })

  test('preserves an anomaly row (CPU spike) buried in the middle', () => {
    // 100 rows of cpu~45, except a sharp spike at index 60.
    const rows = Array.from({ length: 100 }, (_, i) => ({
      ts: 1700000000 + i,
      cpu: i === 60 ? 990 : 44 + (i % 3),
    }))
    const r = crushJsonArray(JSON.stringify(rows), { maxItems: 15 })
    expect(r).not.toBeNull()
    const items = JSON.parse(r!.text).items as Array<Record<string, unknown>>
    const spike = items.find((it) => it.cpu === 990)
    expect(spike).toBeDefined() // the spike survived despite being in the dropped middle
    expect(spike!.ts).toBe(1700000060)
  })

  test('keeps a head and a tail with an omission marker between them', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      seq: i,
      msg: `event number ${i} happened`,
    }))
    const r = crushJsonArray(JSON.stringify(rows), { maxItems: 10 })
    expect(r).not.toBeNull()
    const items = JSON.parse(r!.text).items as Array<Record<string, unknown>>
    expect(items.some((it) => typeof it.__crushed === 'string')).toBe(true)
    // First kept row is the real first row; last kept row is the real last row.
    expect(items[0]).toEqual({ seq: 0, msg: 'event number 0 happened' })
    expect(items[items.length - 1]).toEqual({ seq: 49, msg: 'event number 49 happened' })
  })
})
