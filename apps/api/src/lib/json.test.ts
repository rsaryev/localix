import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJsonFile, safeJsonParse } from './json'

describe('safeJsonParse', () => {
  test('parses valid JSON into the typed value', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3])
  })

  test('null / undefined / empty string → null', () => {
    expect(safeJsonParse(null)).toBeNull()
    expect(safeJsonParse(undefined)).toBeNull()
    expect(safeJsonParse('')).toBeNull()
  })

  test('malformed JSON → null (never throws)', () => {
    expect(() => safeJsonParse('{not json')).not.toThrow()
    expect(safeJsonParse('{not json')).toBeNull()
    expect(safeJsonParse('undefined')).toBeNull()
  })

  test('the literal "null" parses to JSON null', () => {
    expect(safeJsonParse('null')).toBeNull()
  })
})

describe('readJsonFile', () => {
  test('parses a file, and is undefined for a missing or malformed one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'json-file-'))
    try {
      await writeFile(join(dir, 'ok.json'), '{"a":1}')
      await writeFile(join(dir, 'bad.json'), '{')
      expect(await readJsonFile(join(dir, 'ok.json'))).toEqual({ a: 1 })
      expect(await readJsonFile(join(dir, 'bad.json'))).toBeUndefined()
      expect(await readJsonFile(join(dir, 'missing.json'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
