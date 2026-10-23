import { describe, expect, test } from 'bun:test'
import { fileExtension } from './file-types'

describe('mini app file-type vocabulary', () => {
  test('normalizes only a final filename extension', () => {
    expect(fileExtension('/tmp/archive/report.PDF')).toBe('pdf')
    expect(fileExtension('/tmp/.env')).toBe('')
    expect(fileExtension('README')).toBe('')
  })
})
