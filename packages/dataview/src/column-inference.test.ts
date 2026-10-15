import { expect, test } from 'bun:test'
import { inferColumns, inferColumnsFromObjects, inferType } from './parse'

test('delimited inference samples exactly the first 200 rows', () => {
  const rows = Array.from({ length: 200 }, () => ['1'])
  rows.push(['not numeric'])
  expect(inferColumns(['Value'], rows)).toEqual([{ id: 'value', title: 'Value', type: 'int' }])
  rows[199] = ['not numeric']
  expect(inferColumns(['Value'], rows)[0]!.type).toBe('text')
})

test('object inference keeps first-seen keys and ignores fields first appearing after row 200', () => {
  const rows: Record<string, string | number>[] = Array.from({ length: 200 }, () => ({ first: 1 }))
  rows[199] = { first: 2, lastSample: 'yes' }
  rows.push({ first: 'not numeric', tooLate: 3 })
  expect(inferColumnsFromObjects(rows)).toEqual([
    { id: 'first', title: 'first', type: 'int' },
    { id: 'lastSample', title: 'lastSample', type: 'bool' },
  ])
})

test('numeric inference accepts plain decimals only and dates remain syntactic', () => {
  expect(inferType([' 42 ', '-7', '0'])).toBe('int')
  expect(inferType(['1.5', '-.25', '3e8', '2'])).toBe('float')
  // Hex, Infinity and zero-padded codes are not numbers a table column should coerce.
  expect(inferType(['0x10', '12'])).toBe('text')
  expect(inferType(['Infinity', '-Infinity'])).toBe('text')
  expect(inferType(['007', '012'])).toBe('text')
  expect(inferType(['1.', '5'])).toBe('text')
  expect(inferType(['2025-99-99'])).toBe('date')
  expect(inferType([null, undefined, ' '])).toBe('text')
})
