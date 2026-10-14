import { expect, test } from 'bun:test'
import { ELISION_MARKER } from '@localixai/agent'
import { isWireDumpPointer } from './wire-dump-pointer'

test('the pointer ceiling excludes full content that mentions a marker', () => {
  const content = `[output ${ELISION_MARKER} — 900 chars]`
  expect(isWireDumpPointer(content, 399)).toBe(true)
  expect(isWireDumpPointer(content, 400)).toBe(false)
  expect(isWireDumpPointer(content, 401)).toBe(false)
})

test('compression markers are recognized but ordinary messages are not', () => {
  expect(isWireDumpPointer(`[${ELISION_MARKER}]`, 1)).toBe(true)
  expect(isWireDumpPointer('ordinary file contents', 1)).toBe(false)
})
