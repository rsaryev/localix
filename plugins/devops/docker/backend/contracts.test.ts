import { describe, expect, test } from 'bun:test'
import { logsQuerySchema, removeQuerySchema } from './contracts'

// Query params always arrive as STRINGS — these schemas must accept the string
// forms the UI actually sends (`?force=false`, `?tail=200`).
describe('removeQuerySchema', () => {
  test('parses the string query forms', () => {
    expect(removeQuerySchema.parse({ force: 'true' })).toEqual({ force: true })
    expect(removeQuerySchema.parse({ force: 'false' })).toEqual({ force: false })
    expect(removeQuerySchema.parse({})).toEqual({})
  })

  test('rejects junk instead of silently force-removing', () => {
    expect(removeQuerySchema.safeParse({ force: 'yolo' }).success).toBe(false)
  })
})

describe('logsQuerySchema', () => {
  test('coerces the string tail and enforces bounds', () => {
    expect(logsQuerySchema.parse({ tail: '200', sinceSeconds: '6' })).toEqual({
      tail: 200,
      sinceSeconds: 6,
    })
    expect(logsQuerySchema.parse({})).toEqual({})
    expect(logsQuerySchema.safeParse({ tail: '0' }).success).toBe(false)
    expect(logsQuerySchema.safeParse({ tail: '999999' }).success).toBe(false)
    expect(logsQuerySchema.safeParse({ sinceSeconds: '0' }).success).toBe(false)
  })
})
