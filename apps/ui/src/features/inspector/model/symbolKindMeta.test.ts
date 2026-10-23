import { expect, test } from 'bun:test'
import { symbolKindMeta } from './symbolKindMeta'

test('LSP symbol kinds fold into a few labelled groups', () => {
  const labels = [12, 6, 5, 11, 10, 23, 14, 13, 8, 22, 26, 1].map(
    (kind) => symbolKindMeta(kind).label,
  )
  expect(labels).toEqual([
    'function',
    'method',
    'class',
    'interface',
    'enum',
    'type',
    'constant',
    'variable',
    'field',
    'value',
    'type param',
    'symbol',
  ])
  expect(symbolKindMeta(9).Icon).toBe(symbolKindMeta(12).Icon)
  expect(symbolKindMeta(1).Icon).not.toBe(symbolKindMeta(12).Icon)
})
