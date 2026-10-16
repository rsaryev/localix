import { expect, test } from 'bun:test'
import { scopeChangeActions } from './scopeChangeActions'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'

test('folder discard uses only files in the selected group, including collapsed descendants', () => {
  const files: RepoFileChange[] = ['src/unstaged.ts', 'src/nested/MM.ts', 'src-other/a.ts'].map(
    (path) => ({
      path,
      status: 'modified',
      staged: path.includes('MM'),
      unstaged: true,
      insertions: 1,
      deletions: 0,
    }),
  )
  let discarded: string[] = []
  let staged: string[] = []
  let unstaged: string[] = []
  const actions = scopeChangeActions(
    {
      onDiscard: (paths) => {
        discarded = paths
      },
      onStage: (paths) => {
        staged = paths
      },
      onUnstage: (paths) => {
        unstaged = paths
      },
    },
    files,
  )
  actions.onDiscard(['src'], 'src/')
  actions.onStage(['src'])
  actions.onUnstage(['src'])
  expect(discarded).toEqual(['src/unstaged.ts', 'src/nested/MM.ts'])
  expect(staged).toEqual(discarded)
  expect(unstaged).toEqual(discarded)
})

test('selection expansion preserves raw Git path identities without normalization', () => {
  const identities = [
    '',
    '/',
    '/file.ts',
    '//file.ts',
    'src',
    'src/',
    'src/a.ts',
    'src//a.ts',
    'src-other/a.ts',
    'src/../outside.ts',
    'src\\a.ts',
  ]
  const files: RepoFileChange[] = identities.map((path) => ({
    path,
    status: 'modified',
    staged: false,
    unstaged: true,
    insertions: 0,
    deletions: 0,
  }))
  let staged: string[] = []
  const actions = scopeChangeActions(
    {
      onStage: (paths) => {
        staged = paths
      },
      onUnstage: () => {},
      onDiscard: () => {},
    },
    files,
  )

  const cases: Array<[string[], string[]]> = [
    [[], []],
    [[''], ['', '/', '/file.ts', '//file.ts']],
    [['/'], ['/', '//file.ts']],
    [['src'], ['src', 'src/', 'src/a.ts', 'src//a.ts', 'src/../outside.ts']],
    [['src/'], ['src/', 'src//a.ts']],
    [['src/a.ts'], ['src/a.ts']],
    [['missing'], []],
    [
      ['src', 'src/a.ts'],
      ['src', 'src/', 'src/a.ts', 'src//a.ts', 'src/../outside.ts'],
    ],
  ]
  for (const [selection, expected] of cases) {
    actions.onStage(selection)
    expect(staged).toEqual(expected)
  }
})
