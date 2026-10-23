import { describe, expect, test } from 'bun:test'
import type { SourceControlStatus } from '../../../backend/source-control/contracts'
import { repoPresence } from './repoPresence'

const status = (over: Partial<SourceControlStatus>): SourceControlStatus => ({
  isRepo: false,
  vcs: null,
  root: null,
  branch: null,
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  stats: { files: 0, insertions: 0, deletions: 0 },
  ...over,
})

// The poller stops its interval only on `not-repo`, and the panel shows "Not a git repository"
// only then — so a startup answer for a directory the host had not bound yet must not read so.
describe('repo presence', () => {
  test('an unresolved directory is pending, not "not a repo"', () => {
    expect(repoPresence(status({ unresolved: true }))).toBe('pending')
  })

  test('no answer yet is pending', () => {
    expect(repoPresence(null)).toBe('pending')
    expect(repoPresence(undefined)).toBe('pending')
  })

  test('a resolved directory answers with a verdict', () => {
    expect(repoPresence(status({}))).toBe('not-repo')
    expect(repoPresence(status({ isRepo: true, vcs: 'git' }))).toBe('repo')
  })
})
