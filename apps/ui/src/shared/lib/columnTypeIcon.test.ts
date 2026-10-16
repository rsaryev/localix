import { describe, expect, it } from 'bun:test'
import { Hash, Type, Calendar, ToggleLeft, Braces, Binary } from 'lucide-react'
import { columnTypeKind, columnTypeIcon } from './columnTypeIcon'

describe('columnTypeKind', () => {
  it('maps normalized dataview cell types', () => {
    expect(columnTypeKind('number')).toBe('numeric')
    expect(columnTypeKind('int')).toBe('numeric')
    expect(columnTypeKind('float')).toBe('numeric')
    expect(columnTypeKind('text')).toBe('text')
    expect(columnTypeKind('bool')).toBe('bool')
    expect(columnTypeKind('date')).toBe('date')
  })

  it('maps raw DB type names by keyword', () => {
    expect(columnTypeKind('bigint')).toBe('numeric')
    expect(columnTypeKind('numeric(10,2)')).toBe('numeric')
    expect(columnTypeKind('double precision')).toBe('numeric')
    expect(columnTypeKind('serial')).toBe('numeric')
    expect(columnTypeKind('varchar(255)')).toBe('text')
    expect(columnTypeKind('uuid')).toBe('text')
    expect(columnTypeKind('boolean')).toBe('bool')
    expect(columnTypeKind('timestamptz')).toBe('date')
    expect(columnTypeKind('time without time zone')).toBe('date')
    expect(columnTypeKind('jsonb')).toBe('json')
    expect(columnTypeKind('bytea')).toBe('binary')
    expect(columnTypeKind('blob')).toBe('binary')
  })

  it('checks specific families before the generic buckets', () => {
    // "boolean" contains no int/text substrings but must not fall through to text logic.
    expect(columnTypeKind('boolean')).toBe('bool')
    // "timestamp" must be a date, not caught by any numeric keyword.
    expect(columnTypeKind('timestamp')).toBe('date')
  })

  it('falls back to text for unknown types', () => {
    expect(columnTypeKind('geography')).toBe('text')
    expect(columnTypeKind('')).toBe('text')
  })
})

describe('columnTypeIcon', () => {
  it('maps each family to its lucide glyph', () => {
    expect(columnTypeIcon('int')).toBe(Hash)
    expect(columnTypeIcon('varchar')).toBe(Type)
    expect(columnTypeIcon('timestamptz')).toBe(Calendar)
    expect(columnTypeIcon('boolean')).toBe(ToggleLeft)
    expect(columnTypeIcon('jsonb')).toBe(Braces)
    expect(columnTypeIcon('bytea')).toBe(Binary)
  })

  it('uses the text glyph as the default', () => {
    expect(columnTypeIcon('geography')).toBe(Type)
  })
})
