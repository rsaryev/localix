import { describe, expect, it } from 'bun:test'
import { schemaTableKey } from './schemaKey'

describe('schemaTableKey', () => {
  it('keeps the bare table name for a connection with no namespace', () => {
    expect(schemaTableKey('events')).toBe('events')
  })

  it('cannot collide when a schema or table contains the old separator', () => {
    expect(schemaTableKey('b\u001fc', 'a')).not.toBe(schemaTableKey('c', 'a\u001fb'))
  })
})
