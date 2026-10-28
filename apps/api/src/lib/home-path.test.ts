import { expect, test } from 'bun:test'

import { expandHome, isHomePath } from './home-path'

test('only ~ and ~/ name the home directory', () => {
  expect(expandHome('~', '/h')).toBe('/h')
  expect(expandHome('~/a/b', '/h')).toBe('/h/a/b')
  expect(expandHome('~other/a', '/h')).toBe('~other/a')
  expect(expandHome('/abs', '/h')).toBe('/abs')
  expect(isHomePath('~x')).toBe(false)
})
