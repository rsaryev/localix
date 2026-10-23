import { describe, expect, it } from 'bun:test'
import type { SourceControlStatus } from '../../backend/source-control/contracts'
import { buildTreeGitIndex, gitignoreRepoRoot, owningRepoRoot } from './useFileTreeDecorations'

const status = (files: SourceControlStatus['files'], root = '/repo'): SourceControlStatus => ({
  isRepo: true,
  vcs: 'git',
  root,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files,
  stats: { files: files.length, insertions: 0, deletions: 0 },
})

const file = (
  path: string,
  s: SourceControlStatus['files'][number]['status'],
): SourceControlStatus['files'][number] => ({
  path,
  status: s,
  staged: false,
  unstaged: true,
  insertions: 1,
  deletions: 0,
})

describe('buildTreeGitIndex', () => {
  it('returns an empty index for a non-repo / clean tree', () => {
    expect(buildTreeGitIndex(null).dirty).toBe(false)
    expect(buildTreeGitIndex(status([])).dirty).toBe(false)
  })

  it('maps absolute file paths to their status', () => {
    const idx = buildTreeGitIndex(
      status([file('src/a.ts', 'modified'), file('README.md', 'untracked')]),
    )
    expect(idx.statusFor('/repo/src/a.ts')).toBe('modified')
    expect(idx.statusFor('/repo/README.md')).toBe('untracked')
    expect(idx.statusFor('/repo/src/b.ts')).toBeUndefined()
    expect(idx.dirty).toBe(true)
  })

  it('marks every ancestor directory of a changed file', () => {
    const idx = buildTreeGitIndex(status([file('src/deep/nested/x.ts', 'added')]))
    expect(idx.dirHasChanges('/repo/src')).toBe(true)
    expect(idx.dirHasChanges('/repo/src/deep')).toBe(true)
    expect(idx.dirHasChanges('/repo/src/deep/nested')).toBe(true)
    expect(idx.dirHasChanges('/repo/src/deep/nested/')).toBe(true) // trailing slash tolerated
    expect(idx.dirHasChanges('/repo/other')).toBe(false)
  })

  it('handles a repo root with a trailing slash', () => {
    const idx = buildTreeGitIndex(status([file('a.ts', 'modified')], '/repo/'))
    expect(idx.statusFor('/repo/a.ts')).toBe('modified')
  })
})

describe('owningRepoRoot', () => {
  it('selects the deepest owning repo for a nested repository path', () => {
    expect(
      owningRepoRoot(
        ['/workspace', '/workspace/packages/nested'],
        '/workspace/packages/nested/src/a.ts',
      ),
    ).toBe('/workspace/packages/nested')
  })

  it('does not confuse sibling path prefixes', () => {
    expect(owningRepoRoot(['/workspace/app'], '/workspace/application/a.ts')).toBeNull()
  })

  it('uses the parent repo when ignoring a nested repository root itself', () => {
    expect(
      gitignoreRepoRoot(['/workspace', '/workspace/packages/nested'], '/workspace/packages/nested'),
    ).toBe('/workspace')
    expect(
      gitignoreRepoRoot(
        ['/workspace', '/workspace/packages/nested'],
        '/workspace/packages/nested/src/a.ts',
      ),
    ).toBe('/workspace/packages/nested')
  })
})
