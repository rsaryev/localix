import { describe, expect, test } from 'bun:test'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { GitResult, GitRunner } from './cli'
import { getFileHunks } from './hunks'
import { getFileDiffLines, stageLines } from './line-staging'

const CUT: GitResult = {
  ok: false,
  stdout: 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n-one\n+ONE\n two\n-thr',
  stderr: '',
  code: 1,
  truncated: true,
}
const replay =
  (result: GitResult): GitRunner =>
  async () =>
    result

describe('an overflowing single-file diff', () => {
  test('offers no selectable lines and says why', async () => {
    const view = await getFileDiffLines(replay(CUT), '/repo', { path: 'f', mode: 'unstaged' })
    expect(view).toEqual({
      path: 'f',
      mode: 'unstaged',
      diffId: '',
      lines: [],
      binary: false,
      truncated: true,
    })
  })

  test('refuses a line op rather than staging against a cut patch', async () => {
    let caught: unknown
    try {
      await stageLines(replay(CUT), '/repo', { path: 'f', lines: [4, 5], diffId: 'x' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('line_stage_too_large')
  })

  test('drops the last, possibly partial, hunk and keeps the complete ones', async () => {
    const twoHunks: GitResult = {
      ...CUT,
      stdout: 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n@@ -9,3 +9,3 @@\n-x\n-y',
    }
    const hunks = await getFileHunks(replay(twoHunks), 'f')
    expect(hunks.map((h) => h.header)).toEqual(['@@ -1 +1 @@'])
  })
})
