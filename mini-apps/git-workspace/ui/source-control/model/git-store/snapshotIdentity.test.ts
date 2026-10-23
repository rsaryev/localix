import { describe, expect, test } from 'bun:test'
import type {
  RepoWithStatus,
  SourceControlStatus,
} from '../../../../backend/source-control/contracts'
import { keepFocusedStatus, keepRepos, sameStatus } from './snapshotIdentity'

const status = (root: string, version: string | undefined, count = 3): SourceControlStatus => ({
  isRepo: true,
  vcs: 'git',
  root,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: Array.from({ length: count }, (_, i) => ({
    path: `f${i}.ts`,
    status: 'modified' as const,
    staged: false,
    unstaged: true,
    insertions: 1,
    deletions: 0,
  })),
  stats: { files: count, insertions: count, deletions: 0 },
  ...(version ? { changeVersion: version } : {}),
})

const repo = (value: SourceControlStatus): RepoWithStatus => ({
  root: value.root!,
  name: value.root!,
  isPrimary: false,
  status: value,
})

describe('poll snapshot identity', () => {
  test('equal changeVersions compare without walking the file list', () => {
    const a = status('/r', 'v1', 5000)
    const b = status('/r', 'v1', 5000)
    // Poison b's files: a walk would see the difference; the O(1) path must not look.
    Object.defineProperty(b.files, 0, {
      get() {
        throw new Error('file list was walked')
      },
    })
    expect(sameStatus(a, b)).toBe(true)
  })

  test('a moved branch-level scalar is a change even with the same changeVersion', () => {
    expect(sameStatus(status('/r', 'v1'), { ...status('/r', 'v1'), behind: 2 })).toBe(false)
    expect(
      sameStatus(status('/r', 'v1'), { ...status('/r', 'v1'), rebase: { rebasing: true } }),
    ).toBe(false)
  })

  test('HEAD moving is a change even when no changed path moved (an outside commit)', () => {
    const before = { ...status('/r', 'v1'), head: 'a'.repeat(40) }
    expect(sameStatus(before, { ...before, head: 'b'.repeat(40) })).toBe(false)
  })

  test('without a changeVersion the file list is compared field by field', () => {
    const a = status('/r', undefined)
    const b = status('/r', undefined)
    expect(sameStatus(a, b)).toBe(true)
    b.files[1] = { ...b.files[1]!, staged: true }
    expect(sameStatus(a, b)).toBe(false)
  })

  test('an unchanged inventory returns the cached array; one changed repo keeps the others', () => {
    const prev = [repo(status('/a', 'v1')), repo(status('/b', 'v1'))]
    expect(keepRepos(prev, [repo(status('/a', 'v1')), repo(status('/b', 'v1'))])).toBe(prev)

    const next = keepRepos(prev, [repo(status('/a', 'v1')), repo(status('/b', 'v2'))])
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0]!)
    expect(next[1]).not.toBe(prev[1]!)
  })

  test('the focused status shares one object with its inventory row', () => {
    const repos = [repo(status('/a', 'v2'))]
    const focused = keepFocusedStatus(status('/a', 'v1'), status('/a', 'v2'), repos)
    expect(focused).toBe(repos[0]!.status)
  })
})
