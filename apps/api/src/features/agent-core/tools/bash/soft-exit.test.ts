import { describe, expect, test } from 'bun:test'

import { isNoFindingsExit } from './soft-exit'

describe('isNoFindingsExit', () => {
  test('grep/rg/diff family exit 1 is a findings status', () => {
    expect(isNoFindingsExit('grep -rn "needle" src/', 1)).toBe(true)
    expect(isNoFindingsExit('rg --json needle', 1)).toBe(true)
    expect(isNoFindingsExit('diff a.txt b.txt', 1)).toBe(true)
    expect(isNoFindingsExit('cmp -s a b', 1)).toBe(true)
    expect(isNoFindingsExit('git diff --exit-code -- src/', 1)).toBe(true)
    expect(isNoFindingsExit('git grep -n token', 1)).toBe(true)
  })

  test('leading env assignments and absolute paths are seen through', () => {
    expect(isNoFindingsExit('LC_ALL=C grep foo bar.txt', 1)).toBe(true)
    expect(isNoFindingsExit('/usr/bin/grep foo bar.txt', 1)).toBe(true)
  })

  test('only exit code exactly 1 qualifies', () => {
    expect(isNoFindingsExit('grep foo bar.txt', 2)).toBe(false) // grep 2 = real error
    expect(isNoFindingsExit('grep foo bar.txt', 0)).toBe(false)
    expect(isNoFindingsExit('diff a b', 2)).toBe(false) // diff 2 = trouble
  })

  test('pipelines and compounds keep the strict reading', () => {
    expect(isNoFindingsExit('grep foo bar.txt | head -5', 1)).toBe(false)
    expect(isNoFindingsExit('grep foo a && echo ok', 1)).toBe(false)
    expect(isNoFindingsExit('grep foo a; echo done', 1)).toBe(false)
    expect(isNoFindingsExit('echo $(grep foo a)', 1)).toBe(false)
  })

  test('failure-reporting commands stay errors', () => {
    expect(isNoFindingsExit('tsc --noEmit', 1)).toBe(false)
    expect(isNoFindingsExit('bun test', 1)).toBe(false)
    expect(isNoFindingsExit('git status', 1)).toBe(false)
    expect(isNoFindingsExit('git diffx', 1)).toBe(false)
  })
})
