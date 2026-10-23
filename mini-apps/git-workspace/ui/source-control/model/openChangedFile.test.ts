import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui'
import type { RepoFileChange } from '../../../backend/source-control/contracts'
import { sourceControlApi } from '../../api'
import { openChangedFile } from './openChangedFile'

const file = (path: string, extra: Partial<RepoFileChange> = {}): RepoFileChange => ({
  path,
  status: 'modified',
  staged: false,
  unstaged: true,
  insertions: 0,
  deletions: 0,
  ...extra,
})

const openFile = spyOn(miniAppWorkspace, 'openFile').mockImplementation(() => {})
const openDiff = spyOn(miniAppWorkspace, 'openDiff').mockImplementation(() => {})
const loadDiff = spyOn(sourceControlApi, 'getFileDiff').mockResolvedValue({
  path: 'data',
  diff: 'Binary files differ',
  binary: true,
})

afterAll(() => {
  openFile.mockRestore()
  openDiff.mockRestore()
  loadDiff.mockRestore()
})

afterEach(() => {
  openFile.mockClear()
  openDiff.mockClear()
  loadDiff.mockClear()
})

describe('opening a changed file', () => {
  test('opens tracked, staged and untracked media using the ordinary file viewer', async () => {
    for (const path of ['logo.PNG', 'guide.pdf', 'clip.mp4', 'sound.wav', 'report.docx']) {
      for (const status of ['modified', 'added', 'untracked'] as const) {
        await openChangedFile('s', file(path, { status }), status === 'added', '/other/repo/')
        expect(openFile).toHaveBeenLastCalledWith({ sessionId: 's', path: `/other/repo/${path}` })
      }
    }
    expect(openDiff).not.toHaveBeenCalled()
    expect(loadDiff).not.toHaveBeenCalled()
  })

  test('opens unknown tracked binary formats using Git’s binary flag', async () => {
    await openChangedFile('s', file('data.custom', { binary: true }), true, '/repo')
    expect(openFile).toHaveBeenCalledWith({ sessionId: 's', path: '/repo/data.custom' })
    expect(openDiff).not.toHaveBeenCalled()
  })

  test('opens unknown untracked binary formats after the diff detects them', async () => {
    await openChangedFile('s', file('data.custom', { status: 'untracked' }), false, '/repo')
    expect(loadDiff).toHaveBeenCalledWith(
      's',
      '/repo/data.custom',
      { staged: false, untracked: true },
      '/repo',
    )
    expect(openFile).toHaveBeenCalledWith({ sessionId: 's', path: '/repo/data.custom' })
    expect(openDiff).not.toHaveBeenCalled()
  })

  test('keeps staging diffs for text, CSV and SVG without a duplicate fetch', async () => {
    for (const path of ['code.ts', 'data.csv', 'logo.svg']) {
      await openChangedFile('s', file(path), true, '/repo')
      expect(openDiff).toHaveBeenLastCalledWith(
        expect.objectContaining({
          path: `/repo/${path}`,
          staging: { sessionId: 's', path, mode: 'staged', repoRoot: '/repo' },
        }),
      )
    }
    expect(openFile).not.toHaveBeenCalled()
    expect(loadDiff).not.toHaveBeenCalled()
  })

  test('keeps deleted binary files in the diff instead of opening a missing file', async () => {
    await openChangedFile(
      's',
      file('logo.png', { status: 'deleted', binary: true }),
      false,
      '/repo',
    )
    expect(openFile).not.toHaveBeenCalled()
    expect(openDiff).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })

  test('keeps the conflict resolver accessible', async () => {
    await openChangedFile('s', file('code.ts', { status: 'conflicted' }), false, '/repo')
    expect(openFile).toHaveBeenCalledWith({ sessionId: 's', path: '/repo/code.ts' })
    expect(openDiff).not.toHaveBeenCalled()
  })
})
