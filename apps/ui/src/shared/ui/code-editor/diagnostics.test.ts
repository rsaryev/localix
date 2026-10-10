import { expect, test } from 'bun:test'
import { formatDiagnosticSource } from './types'

test.each([
  [undefined, undefined, undefined],
  ['', undefined, undefined],
  ['ts', undefined, 'ts'],
  ['ts', '', 'ts'],
  ['ts', 0, 'ts(0)'],
  [undefined, 0, '0'],
  ['', 'TS2304', 'TS2304'],
  ['eslint', 'no-unused-vars', 'eslint(no-unused-vars)'],
] as const)('formats diagnostic source %s and code %s as %s', (source, code, expected) => {
  expect(formatDiagnosticSource(source, code)).toBe(expected)
})
