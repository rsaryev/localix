import { expect, test } from 'bun:test'
import { ELISION_MARKER } from '@localixai/agent'
import { readDedupStub } from '../../../agent-core/tools/file/read-dedup-stub'
import { isWireDumpPointer } from './wire-dump-pointer'

test('the real read emitter is recognized through the protocol leaf', () => {
  expect(isWireDumpPointer(JSON.stringify({ content: readDedupStub('src/file.ts') }), 100)).toBe(
    true,
  )
})

test('the pointer ceiling excludes full content that mentions a marker', () => {
  const content = readDedupStub('src/file.ts')
  expect(isWireDumpPointer(content, 399)).toBe(true)
  expect(isWireDumpPointer(content, 400)).toBe(false)
  expect(isWireDumpPointer(content, 401)).toBe(false)
})

test('compression markers are recognized but ordinary messages are not', () => {
  expect(isWireDumpPointer(`[${ELISION_MARKER}]`, 1)).toBe(true)
  expect(isWireDumpPointer('ordinary file contents', 1)).toBe(false)
})
