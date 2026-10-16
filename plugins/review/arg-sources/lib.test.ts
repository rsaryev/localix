import { describe, expect, test } from 'bun:test'

import { matchesQuery, runLines, splitTab } from './lib'

/**
 * Behavior lock for the pure helpers shared by the /review arg-option scripts
 * (branches/commits/prs menus). A regression here silently corrupts every menu
 * entry (splitTab feeds value/label) or breaks query filtering. The IO shell
 * (readRequest/runLines/emitOptions) is not unit-pure and is left out.
 */
describe('splitTab', () => {
  test('splits on the FIRST tab only; the rest keeps any later tabs', () => {
    expect(splitTab('a\tb')).toEqual(['a', 'b'])
    expect(splitTab('a\tb\tc')).toEqual(['a', 'b\tc'])
  })

  test('a line with no tab → [line, ""]', () => {
    expect(splitTab('main')).toEqual(['main', ''])
  })

  test('a leading tab → empty head', () => {
    expect(splitTab('\trest')).toEqual(['', 'rest'])
  })
})

describe('matchesQuery', () => {
  test('an empty query matches everything', () => {
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('')).toBe(true)
  })

  test('case-insensitive substring against a pre-lowercased query', () => {
    expect(matchesQuery('feat', 'FEATURE/login')).toBe(true)
    expect(matchesQuery('xyz', 'FEATURE/login')).toBe(false)
  })

  test('matches if ANY haystack contains the query', () => {
    expect(matchesQuery('bug', 'main', 'fix-BUG-42')).toBe(true)
    expect(matchesQuery('bug', 'main', 'release')).toBe(false)
  })
})

describe('runLines', () => {
  test('a command that stalls is killed on its own deadline and reads as no options', () => {
    // Unbounded, a stalled `gh` outlived the menu request that spawned it.
    const started = Date.now()
    expect(runLines(['sleep', '5'], process.cwd(), 100)).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('a working command still answers its lines', () => {
    expect(runLines(['printf', 'a\\n\\nb\\n'], process.cwd())).toEqual(['a', 'b'])
  })
})
