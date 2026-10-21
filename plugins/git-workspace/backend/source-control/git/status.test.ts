import { describe, expect, test } from 'bun:test'
import { parseBranchHeader, parseNumstat, parseStatus } from './status'

// A Cyrillic word ("file") built from code points: the source stays English, the path non-ASCII.
const NON_ASCII = String.fromCodePoint(0x0444, 0x0430, 0x0439, 0x043b)

describe('parseBranchHeader', () => {
  test('plain branch, no upstream', () => {
    expect(parseBranchHeader('## main')).toEqual({
      branch: 'main',
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    })
  })

  test('upstream with ahead + behind', () => {
    expect(parseBranchHeader('## main...origin/main [ahead 2, behind 3]')).toEqual({
      branch: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
    })
  })

  test('ahead only', () => {
    expect(parseBranchHeader('## feat...origin/feat [ahead 1]')).toMatchObject({
      ahead: 1,
      behind: 0,
      upstream: 'origin/feat',
    })
  })

  test('detached HEAD', () => {
    expect(parseBranchHeader('## HEAD (no branch)')).toMatchObject({ branch: null, detached: true })
  })

  test('unborn branch (no commits yet)', () => {
    expect(parseBranchHeader('## No commits yet on main')).toMatchObject({
      branch: 'main',
      detached: false,
    })
  })
})

describe('parseStatus', () => {
  test('rename record is destination-first, then original', () => {
    // Mirrors real `git status --porcelain=v1 -b -z` output (verified against git).
    const raw = '## main\0R  b.txt\0a.txt\0?? new.txt\0'
    const parsed = parseStatus(raw)
    expect(parsed.branch).toBe('main')
    expect(parsed.files).toHaveLength(2)

    const [rename, untracked] = parsed.files
    expect(rename).toMatchObject({
      path: 'b.txt',
      oldPath: 'a.txt',
      status: 'renamed',
      staged: true,
      unstaged: false,
    })
    expect(untracked).toMatchObject({
      path: 'new.txt',
      status: 'untracked',
      staged: false,
      unstaged: true,
    })
  })

  test('staged + unstaged modification flags', () => {
    const parsed = parseStatus(
      '## main\0MM staged-and-dirty.ts\0 M only-dirty.ts\0M  only-staged.ts\0',
    )
    expect(parsed.files).toEqual([
      {
        path: 'staged-and-dirty.ts',
        oldPath: undefined,
        status: 'modified',
        staged: true,
        unstaged: true,
      },
      {
        path: 'only-dirty.ts',
        oldPath: undefined,
        status: 'modified',
        staged: false,
        unstaged: true,
      },
      {
        path: 'only-staged.ts',
        oldPath: undefined,
        status: 'modified',
        staged: true,
        unstaged: false,
      },
    ])
  })

  test('conflict + delete', () => {
    const parsed = parseStatus('## main\0UU conflict.ts\0 D gone.ts\0')
    expect(parsed.files[0]).toMatchObject({
      status: 'conflicted',
      staged: false,
      unstaged: false,
    })
    expect(parsed.files[1]).toMatchObject({ status: 'deleted', staged: false, unstaged: true })
  })

  test('all unmerged porcelain combinations stay out of ordinary diff groups', () => {
    const parsed = parseStatus(
      '## main\0DD both-deleted\0AU added-by-us\0UD deleted-by-them\0UA added-by-them\0DU deleted-by-us\0AA both-added\0UU both-modified\0',
    )
    expect(parsed.files).toHaveLength(7)
    expect(parsed.files.every((file) => file.status === 'conflicted')).toBe(true)
    expect(parsed.files.every((file) => !file.staged && !file.unstaged)).toBe(true)
  })

  test('empty input yields no files', () => {
    expect(parseStatus('').files).toEqual([])
  })
})

describe('parseNumstat (-z)', () => {
  test('counts, binary, raw non-ASCII paths and the three-record rename form', () => {
    const map = parseNumstat(
      [
        '12\t3\tsrc/app.ts',
        '-\t-\tlogo.png',
        `2\t1\tdocs/${NON_ASCII}.txt`,
        '4\t0\t',
        'src/old dir/file.ts',
        'src/new dir/file.ts',
        '',
      ].join('\0'),
    )
    expect(map.get('src/app.ts')).toEqual({ insertions: 12, deletions: 3 })
    expect(map.get('logo.png')).toEqual({ insertions: 0, deletions: 0, binary: true })
    expect(map.get(`docs/${NON_ASCII}.txt`)).toEqual({ insertions: 2, deletions: 1 })
    expect(map.get('src/new dir/file.ts')).toEqual({ insertions: 4, deletions: 0 })
    expect(map.has('src/old dir/file.ts')).toBe(false)
  })
})

/**
 * Against real git, because the defect lived in the gap between two git outputs: without `-z`
 * the numstat C-quoted a non-ASCII path and printed a rename as `old => new`, while porcelain
 * status named both raw, so the join by path missed and both files showed +0/-0.
 */
