import { describe, expect, test } from 'bun:test'
import { blameFile, parseBlamePorcelain } from './blame'
import type { GitResult, GitRunner } from './cli'

const ok = (stdout: string): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (): GitResult => ({ ok: false, stdout: '', stderr: 'fatal: no such path', code: 128 })
const runner =
  (result: GitResult): GitRunner =>
  async () =>
    result

/** Build one porcelain group (full metadata block, first sighting of a sha). */
function group(
  sha: string,
  finalLine: number,
  meta: { author: string; time: number; summary: string },
  content: string,
): string {
  return [
    `${sha} ${finalLine} ${finalLine} 1`,
    `author ${meta.author}`,
    `author-mail <${meta.author}@example.com>`,
    `author-time ${meta.time}`,
    `author-tz +0000`,
    `committer ${meta.author}`,
    `committer-time ${meta.time}`,
    `summary ${meta.summary}`,
    `filename foo.ts`,
    `\t${content}`,
  ].join('\n')
}

/** A repeated sha: header + tab content only, NO metadata block (relies on the cache). */
function repeat(sha: string, finalLine: number, content: string): string {
  return [`${sha} ${finalLine} ${finalLine} 1`, `\t${content}`].join('\n')
}

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const ZERO = '0'.repeat(40)

describe('parseBlamePorcelain', () => {
  test('empty input → empty list', () => {
    expect(parseBlamePorcelain('')).toEqual([])
  })

  test('parses a single committed line', () => {
    const out = group(
      SHA_A,
      1,
      { author: 'Ada', time: 1700000000, summary: 'feat: start' },
      'const x = 1',
    )
    expect(parseBlamePorcelain(out)).toEqual([
      {
        line: 1,
        sha: SHA_A,
        author: 'Ada',
        authorTime: 1700000000,
        summary: 'feat: start',
        uncommitted: false,
      },
    ])
  })

  test('parses multiple distinct commits', () => {
    const out = [
      group(SHA_A, 1, { author: 'Ada', time: 1700000000, summary: 'feat: a' }, 'line one'),
      group(SHA_B, 2, { author: 'Bo', time: 1700000500, summary: 'fix: b' }, 'line two'),
    ].join('\n')
    const lines = parseBlamePorcelain(out)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ line: 1, sha: SHA_A, author: 'Ada', summary: 'feat: a' })
    expect(lines[1]).toMatchObject({ line: 2, sha: SHA_B, author: 'Bo', summary: 'fix: b' })
  })

  test('reuses cached metadata for a repeated sha (header-once-per-sha)', () => {
    const out = [
      group(SHA_A, 1, { author: 'Ada', time: 1700000000, summary: 'feat: a' }, 'line one'),
      group(SHA_B, 2, { author: 'Bo', time: 1700000500, summary: 'fix: b' }, 'line two'),
      repeat(SHA_A, 3, 'line three'), // same commit as line 1, no metadata block
    ].join('\n')
    const lines = parseBlamePorcelain(out)
    expect(lines).toHaveLength(3)
    // The repeated line must resolve Ada's author/date/summary from the cache.
    expect(lines[2]).toEqual({
      line: 3,
      sha: SHA_A,
      author: 'Ada',
      authorTime: 1700000000,
      summary: 'feat: a',
      uncommitted: false,
    })
  })

  test('flags an uncommitted (all-zero sha) line with blanked author/date', () => {
    const out = [
      `${ZERO} 4 4 1`,
      `author Not Committed Yet`,
      `author-mail <not.committed.yet>`,
      `author-time 1700009999`,
      `author-tz +0000`,
      `summary Version of foo.ts from foo.ts`,
      `filename foo.ts`,
      `\tconst pending = true`,
    ].join('\n')
    expect(parseBlamePorcelain(out)).toEqual([
      { line: 4, sha: ZERO, author: '', authorTime: 0, summary: '', uncommitted: true },
    ])
  })

  test('a summary containing spaces is preserved verbatim', () => {
    const out = group(
      SHA_A,
      7,
      { author: 'Ada', time: 1700000000, summary: 'feat: add a b c thing' },
      'code',
    )
    expect(parseBlamePorcelain(out)[0].summary).toBe('feat: add a b c thing')
  })
})

describe('blameFile', () => {
  test('parses runner output for a committed file', async () => {
    const out = group(
      SHA_A,
      1,
      { author: 'Ada', time: 1700000000, summary: 'feat: start' },
      'const x = 1',
    )
    const lines = await blameFile(runner(ok(out)), 'src/foo.ts')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ sha: SHA_A, author: 'Ada' })
  })

  test('a git failure resolves to an empty list (never throws)', async () => {
    expect(await blameFile(runner(fail()), 'src/foo.ts')).toEqual([])
  })

  test('rejects an unsafe path (empty / leading dash) without running git', async () => {
    let ran = false
    const spy: GitRunner = async () => {
      ran = true
      return ok('')
    }
    expect(await blameFile(spy, '')).toEqual([])
    expect(await blameFile(spy, '-L1,1')).toEqual([])
    expect(ran).toBe(false)
  })

  test('passes an -L range and the -- path separator', async () => {
    let seen: string[] = []
    const spy: GitRunner = async (args) => {
      seen = args
      return ok('')
    }
    await blameFile(spy, 'src/foo.ts', { start: 10, end: 20 })
    expect(seen).toEqual(['blame', '--porcelain', '-L', '10,20', '--', 'src/foo.ts'])
  })

  test('omits -L when no range is given', async () => {
    let seen: string[] = []
    const spy: GitRunner = async (args) => {
      seen = args
      return ok('')
    }
    await blameFile(spy, 'src/foo.ts')
    expect(seen).toEqual(['blame', '--porcelain', '--', 'src/foo.ts'])
  })
})
