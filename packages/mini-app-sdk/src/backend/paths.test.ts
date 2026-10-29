import { describe, expect, test } from 'bun:test'

import { isPathWithin, resolveWithin } from './index'
import { isAtOrUnder } from '../ui/utilities'

// A mini app that serves files from its folder keeps every path inside it; it gets the host's own
// containment rules from the SDK, not from a Localix package it cannot install.
describe('paths a mini app serves', () => {
  test('a name that climbs out of the folder resolves to nothing', () => {
    expect(resolveWithin('/data/books', '../secrets/key')).toBeNull()
    expect(String(resolveWithin('/data/books', 'shelf/one.epub'))).toBe(
      '/data/books/shelf/one.epub',
    )
    expect(isPathWithin('/data/books', '/data/books-old/x')).toBe(false)
  })

  test('the screen asks the same question of a tree it shows', () => {
    expect(isAtOrUnder('src', 'src/app.ts')).toBe(true)
    expect(isAtOrUnder('src', 'srcs/app.ts')).toBe(false)
  })
})
