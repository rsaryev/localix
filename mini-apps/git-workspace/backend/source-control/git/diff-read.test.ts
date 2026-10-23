import { describe, expect, test } from 'bun:test'
import type { GitResult, GitRunner } from './cli'
import { cutToCompleteFile, isBinaryDiff, readDiff, toFileDiff } from './diff-read'

const TEXT =
  'diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
const IMAGE =
  'diff --git a/p.png b/p.png\nindex 3..4 100644\nBinary files a/p.png and b/p.png differ\n'
const BINARY_PATCH =
  'diff --git a/q.bin b/q.bin\nindex 5..6 100644\nGIT binary patch\nliteral 3\nKcmZ?\n'

const replay =
  (result: GitResult): GitRunner =>
  async () =>
    result

describe('isBinaryDiff', () => {
  test('a binary single file is binary, in both of git binary spellings', () => {
    expect(isBinaryDiff(IMAGE)).toBe(true)
    expect(isBinaryDiff(BINARY_PATCH)).toBe(true)
  })

  test('a multi-file diff with ONE binary file among text files is not binary', () => {
    // The old regex marked the whole commit binary here, and the UI refused to open it.
    expect(isBinaryDiff(IMAGE + TEXT)).toBe(false)
    expect(isBinaryDiff(TEXT + BINARY_PATCH)).toBe(false)
  })

  test('only binary files → binary; nothing at all → not binary', () => {
    expect(isBinaryDiff(IMAGE + BINARY_PATCH)).toBe(true)
    expect(isBinaryDiff('')).toBe(false)
    expect(isBinaryDiff(TEXT)).toBe(false)
  })

  test('a combined (`@@@`) hunk counts as text', () => {
    expect(isBinaryDiff(`${IMAGE}diff --cc m.ts\n@@@ -1,1 -1,1 +1,1 @@@\n- a\n +b\n`)).toBe(false)
  })

  test('the words in a content line never read as a binary marker', () => {
    expect(isBinaryDiff(`${TEXT}+Binary files a/x and b/x differ\n`)).toBe(false)
  })
})

describe('cutToCompleteFile', () => {
  test('drops the file the ceiling cut through, keeping every complete file', () => {
    const second = 'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1,9 +1,9 @@\n-par'
    expect(cutToCompleteFile(TEXT + second)).toBe(TEXT)
  })

  test('a single cut file keeps its complete lines only', () => {
    expect(cutToCompleteFile('diff --git a/a b/a\n@@ -1,3 +1,3 @@\n-one\n+tw')).toBe(
      'diff --git a/a b/a\n@@ -1,3 +1,3 @@\n-one\n',
    )
  })

  test('a prefix without one complete line is empty', () => {
    expect(cutToCompleteFile('diff --git a/a')).toBe('')
  })
})

describe('readDiff', () => {
  test('an overflow is truncated, not failed, and cut to a file boundary', async () => {
    const run = replay({
      ok: false,
      stdout: `${TEXT}diff --git a/b b/b\n+x`,
      stderr: '',
      code: 1,
      truncated: true,
    })
    expect(await readDiff(run, ['diff'])).toMatchObject({
      diff: TEXT,
      truncated: true,
      failed: false,
      binary: false,
    })
  })

  test('a refusal is failed and never truncated', async () => {
    const run = replay({ ok: false, stdout: '', stderr: 'fatal: bad revision', code: 128 })
    expect(await readDiff(run, ['diff', 'x'])).toMatchObject({ failed: true, truncated: false })
  })

  test('a deadline-killed read with output keeps its prefix as truncated', async () => {
    const run = replay({
      ok: false,
      stdout: `${TEXT}diff --git a/b`,
      stderr: '',
      code: 124,
      timedOut: true,
    })
    expect(await readDiff(run, ['diff'])).toMatchObject({
      diff: TEXT,
      truncated: true,
      failed: false,
    })
  })

  test('passes the capture ceiling through to the runner', async () => {
    let seen: number | undefined
    const run: GitRunner = async (_args, _env, _timeout, maxBuffer) => {
      seen = maxBuffer
      return { ok: true, stdout: '', stderr: '', code: 0 }
    }
    await readDiff(run, ['diff'], 4_096)
    expect(seen).toBe(4_096)
  })

  test('the wire shape carries truncated only when set', () => {
    expect(toFileDiff('p', { diff: 'd', binary: false, truncated: false })).toEqual({
      path: 'p',
      diff: 'd',
      binary: false,
    })
    expect(toFileDiff('p', { diff: 'd', binary: false, truncated: true }).truncated).toBe(true)
  })
})
