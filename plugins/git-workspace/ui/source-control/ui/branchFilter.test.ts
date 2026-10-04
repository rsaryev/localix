import { describe, expect, test } from 'bun:test'
import { branchMatchScore, filterBranches } from './branchFilter'

const named = (...names: string[]) => names.map((name) => ({ name }))
const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name)

describe('branchMatchScore', () => {
  test('ranks exact over prefix over substring over subsequence', () => {
    const exact = branchMatchScore('feat', 'feat')!
    const prefix = branchMatchScore('feature/login', 'feat')!
    const substring = branchMatchScore('fix/feature-flag', 'feat')!
    const subsequence = branchMatchScore('fast-exit-at', 'feat')!
    expect(exact).toBeLessThan(prefix)
    expect(prefix).toBeLessThan(substring)
    expect(substring).toBeLessThan(subsequence)
  })

  test('an earlier substring beats a later one, but never beats a prefix', () => {
    const early = branchMatchScore('ab/login', 'login')!
    const late = branchMatchScore('a-very-long-prefix-indeed/login', 'login')!
    expect(early).toBeLessThan(late)
    expect(branchMatchScore('login/x', 'login')!).toBeLessThan(early)
  })

  test('is case-insensitive and matches nothing it should not', () => {
    expect(branchMatchScore('Feature/Login', 'feature')).not.toBeNull()
    expect(branchMatchScore('main', 'zzz')).toBeNull()
  })

  test('a blank query matches everything equally', () => {
    expect(branchMatchScore('anything', '   ')).toBe(0)
  })
})

describe('filterBranches', () => {
  test('an empty query returns the SAME array — an unfiltered render allocates nothing', () => {
    const list = named('main', 'dev')
    expect(filterBranches(list, '')).toBe(list)
    expect(filterBranches(list, '   ')).toBe(list)
  })

  test('ranks matches and drops non-matches', () => {
    const list = named('release/2', 'feature/login', 'fix/feature-flag', 'main')
    expect(names(filterBranches(list, 'feat'))).toEqual(['feature/login', 'fix/feature-flag'])
  })

  test('equal scores keep input order — git already sorted by recency', () => {
    const list = named('feat/newest', 'feat/older', 'feat/oldest')
    expect(names(filterBranches(list, 'feat'))).toEqual([
      'feat/newest',
      'feat/older',
      'feat/oldest',
    ])
  })

  test('the current branch survives any filter and leads', () => {
    const list = named('feature/login', 'main')
    expect(names(filterBranches(list, 'feat', 'main'))).toEqual(['main', 'feature/login'])
    expect(names(filterBranches(list, 'zzzz', 'main'))).toEqual(['main'])
  })

  test('a subsequence match still surfaces a branch nothing else would find', () => {
    const list = named('feature/login')
    expect(names(filterBranches(list, 'fl'))).toEqual(['feature/login'])
  })
})
