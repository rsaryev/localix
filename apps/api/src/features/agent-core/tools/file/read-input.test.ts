import { expect, test } from 'bun:test'

import { prepareReadArguments, readToolInputSchema } from './read-input'

test('bare and JSON-string batch items become path items on the dispatch path', () => {
  expect(prepareReadArguments({ reads: ['a.ts', { path: 'b.ts', start_line: 2 }] })).toEqual({
    reads: [{ path: 'a.ts' }, { path: 'b.ts', start_line: 2 }],
  })
  expect(prepareReadArguments({ reads: '["a.ts","b.ts"]' })).toEqual({
    reads: [{ path: 'a.ts' }, { path: 'b.ts' }],
  })
  expect(prepareReadArguments({ path: 'a.ts' })).toEqual({ path: 'a.ts' })
})

test('LOCALIX-175: one cwd repeated on every item moves to the call', () => {
  const cwd = '/work/LOCALIX-175'
  const raw = { reads: ['index.html', 'styles.css'].map((path) => ({ path, cwd })) }
  const prepared = prepareReadArguments(raw)
  expect(prepared).toEqual({ cwd, reads: [{ path: 'index.html' }, { path: 'styles.css' }] })
  expect(readToolInputSchema.safeParse(prepared).success).toBe(true)
})

test('different or conflicting item cwds are left for the schema to refuse', () => {
  const mixed = {
    reads: [
      { path: 'a', cwd: '/x' },
      { path: 'b', cwd: '/y' },
    ],
  }
  expect(prepareReadArguments(mixed)).toEqual(mixed)
  const conflicting = { cwd: '/z', reads: [{ path: 'a', cwd: '/x' }] }
  expect(prepareReadArguments(conflicting)).toEqual(conflicting)
})

test('LOCALIX-157: an empty path with nothing else lists the base directory', () => {
  expect(prepareReadArguments({ path: '' })).toEqual({ path: '.' })
  expect(prepareReadArguments({ path: '', reads: ['a.ts'] })).toEqual({
    path: '',
    reads: [{ path: 'a.ts' }],
  })
})

// Claude Code's Read: `file_path`, and `offset` is the LINE to start at, with `limit` lines.
test('Claude Code’s file_path names the file', () => {
  expect(prepareReadArguments({ file_path: '/work/a.ts' })).toEqual({ path: '/work/a.ts' })
  expect(prepareReadArguments({ file_path: 'a.ts', path: 'a.ts' })).toEqual({ path: 'a.ts' })
  expect(() => prepareReadArguments({ file_path: 'a.ts', path: 'b.ts' })).toThrow(/file_path/)
})

test('offset is a line number with `limit` lines, as in Claude Code', () => {
  const parsed = readToolInputSchema.parse(
    prepareReadArguments({ file_path: 'a.ts', offset: 11, limit: 5 }),
  )
  expect(parsed).toMatchObject({ path: 'a.ts', start_line: 11, limit: 5 })
  expect('offset' in parsed).toBe(false)
  // A string number, and 0 (Claude Code's "from the start"), read as a line too.
  expect(prepareReadArguments({ path: 'a', offset: '7' })).toEqual({ path: 'a', start_line: 7 })
  expect(prepareReadArguments({ path: 'a', offset: 0, limit: 3 })).toEqual({
    path: 'a',
    start_line: 1,
    limit: 3,
  })
  // The same line named twice is one line; two different lines are a conflict, never a guess.
  expect(prepareReadArguments({ path: 'a', offset: 4, start_line: 4 })).toEqual({
    path: 'a',
    start_line: 4,
  })
  expect(() => prepareReadArguments({ path: 'a', offset: 4, start_line: 9 })).toThrow(/offset/)
})

test('the byte position of a truncated read is `byte_offset`', () => {
  const parsed = readToolInputSchema.parse(prepareReadArguments({ path: 'a', byte_offset: 4096 }))
  expect(parsed.byte_offset).toBe(4096)
  expect(readToolInputSchema.parse({ path: 'a', byte_offset: '12' }).byte_offset).toBe(12)
})
