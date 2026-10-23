import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discard } from './actions'
import { gitRunner, type GitRunner } from './cli'
import { getFileDiff } from './diff'
import { getFileHunks, revertHunk } from './hunks'
import { getFileDiffLines } from './line-staging'
import { getCommitShow } from './show'

/**
 * Process budget per route, measured against a real repo with a counting runner.
 * Each of these used to spend a serial `rev-parse --verify HEAD` (and hunks /
 * line staging a `--show-toplevel` too) before its real work:
 *
 *   route              before  after
 *   file diff             2      1
 *   hunks                 2      1
 *   revert hunk           3      1
 *   diff lines            2      1
 *   commit show           2      1
 *   discard               3      2
 */
describe('spawn budget per read (HEAD present)', () => {
  let dir: string
  let spawns: string[][]
  let run: GitRunner

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-spawns-'))
    const raw = gitRunner(dir)
    await raw(['init', '-q'])
    await raw(['config', 'user.email', 'test@example.com'])
    await raw(['config', 'user.name', 'Test'])
    await raw(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'f.txt'), 'a\nb\n')
    await raw(['add', '-A'])
    await raw(['commit', '-q', '-m', 'init'])
    run = (args, ...rest) => {
      spawns.push(args)
      return raw(args, ...rest)
    }
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const count = async (work: () => Promise<unknown>): Promise<number> => {
    spawns = []
    await work()
    return spawns.length
  }

  test('reads spend one spawn each', async () => {
    await writeFile(join(dir, 'f.txt'), 'a\nB\n')
    expect(await count(() => getFileDiff(run, dir, { path: 'f.txt' }))).toBe(1)
    expect(await count(() => getFileHunks(run, 'f.txt'))).toBe(1)
    expect(await count(() => getFileDiffLines(run, dir, { path: 'f.txt', mode: 'unstaged' }))).toBe(
      1,
    )
    const head = (await gitRunner(dir)(['rev-parse', 'HEAD'])).stdout.trim()
    expect(await count(() => getCommitShow(run, head))).toBe(1)
  })

  test('a hunk revert re-reads once and writes the file itself', async () => {
    await writeFile(join(dir, 'f.txt'), 'a\nB\n')
    const [hunk] = await getFileHunks(run, 'f.txt')
    expect(
      await count(() => revertHunk(run, dir, { path: 'f.txt', index: 0, header: hunk!.header })),
    ).toBe(1)
  })

  test('discard spends ls-files + restore + clean, no HEAD probe', async () => {
    await writeFile(join(dir, 'f.txt'), 'changed\n')
    expect(await count(() => discard(run, ['f.txt']))).toBe(3)
    expect(spawns.some((args) => args[0] === 'rev-parse')).toBe(false)
  })
})

describe('unborn branch still falls back correctly', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-unborn-'))
    const run = gitRunner(dir)
    await run(['init', '-q'])
    await writeFile(join(dir, 'f.txt'), 'staged\n')
    await run(['add', 'f.txt'])
    await writeFile(join(dir, 'f.txt'), 'staged\nmore\n')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('the working diff of a file on an unborn branch is its index diff', async () => {
    const res = await getFileDiff(gitRunner(dir), dir, { path: 'f.txt' })
    expect(res.diff).toContain('+more')
  })

  test('hunks on an unborn branch read against the index', async () => {
    const hunks = await getFileHunks(gitRunner(dir), 'f.txt')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.newLines).toEqual(['more'])
  })
})
