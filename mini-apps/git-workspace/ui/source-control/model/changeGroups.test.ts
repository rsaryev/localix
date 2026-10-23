import { describe, expect, test } from 'bun:test'
import type { RepoFileChange } from '../../../backend/source-control/contracts'
import { partitionChanges } from './changeGroups'

const file = (path: string, over: Partial<RepoFileChange> = {}): RepoFileChange => ({
  path,
  status: 'modified',
  staged: false,
  unstaged: true,
  insertions: 0,
  deletions: 0,
  ...over,
})

describe('partitionChanges', () => {
  test('a conflict is only a conflict; a partially staged file is in both other groups', () => {
    const groups = partitionChanges([
      file('c.ts', { status: 'conflicted', staged: true, unstaged: true }),
      file('p.ts', { staged: true, unstaged: true }),
      file('s.ts', { staged: true, unstaged: false }),
      file('u.ts'),
    ])
    expect(groups.conflicts.map((f) => f.path)).toEqual(['c.ts'])
    expect(groups.staged.map((f) => f.path)).toEqual(['p.ts', 's.ts'])
    expect(groups.changed.map((f) => f.path)).toEqual(['p.ts', 'u.ts'])
  })
})
