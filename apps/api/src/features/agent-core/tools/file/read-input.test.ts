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
