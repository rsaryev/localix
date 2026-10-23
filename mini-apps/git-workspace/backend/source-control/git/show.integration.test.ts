import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCommitFileDiff, getCommitFiles, getCommitShow, getRangeDiff } from './show'
import { gitRunner, runGit, type GitRunner } from './cli'
import { ApiError } from '@localixai/mini-app-sdk/backend'

/**
 * getCommitShow against a real throwaway repo with ≥2 commits — exercises the
 * normal parent..commit path, the root-commit `--root` fallback, and the
 * bad-ref guard.
 */
describe('getCommitShow', () => {
  let dir: string
  let run: GitRunner
  let rootHash = ''
  let secondHash = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-show-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    // Disable commit signing in THIS repo so `git commit` can't invoke a globally
    // configured signing program (e.g. a 1Password agent) that blocks on an
    // interactive approval — which hangs the headless beforeAll hook to a timeout.
    await run(['config', 'commit.gpgsign', 'false'])

    await writeFile(join(dir, 'a.txt'), 'first\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'root commit'])
    rootHash = (await run(['rev-parse', 'HEAD'])).stdout.trim()

    await writeFile(join(dir, 'a.txt'), 'first\nsecond\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'second commit'])
    secondHash = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a normal commit returns a non-empty unified diff naming the changed file', async () => {
    const res = await getCommitShow(run, secondHash)
    expect(res.binary).toBe(false)
    expect(res.path).toBe(secondHash)
    expect(res.diff).toContain('a.txt')
    expect(res.diff).toContain('+second')
    // Pure patch — no git commit-log preamble for DiffView.
    expect(res.diff).not.toMatch(/^commit /m)
    expect(res.diff).not.toMatch(/^Author:/m)
  })

  test('the root commit (no parent) still returns a patch via the --root path', async () => {
    const res = await getCommitShow(run, rootHash)
    expect(res.diff).toContain('a.txt')
    expect(res.diff).toContain('+first')
    expect(res.diff).not.toMatch(/^commit /m)
  })

  test('a bogus ref returns a safe empty diff, never throws', async () => {
    const res = await getCommitShow(run, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    expect(res.diff).toBe('')
    expect(res.binary).toBe(false)
  })

  test('an unsafe ref (leading dash / whitespace) is rejected without running git', async () => {
    let calls = 0
    const spy: GitRunner = async (args) => {
      calls++
      return runGit(dir, args)
    }
    expect((await getCommitShow(spy, '--upload-pack=evil')).diff).toBe('')
    expect((await getCommitShow(spy, 'a b')).diff).toBe('')
    expect(calls).toBe(0)
  })

  test('getCommitFiles lists the paths a commit touched (root commit too)', async () => {
    expect(await getCommitFiles(run, secondHash)).toEqual(['a.txt'])
    expect(await getCommitFiles(run, rootHash)).toEqual(['a.txt'])
    expect(await getCommitFiles(run, '--upload-pack=evil')).toEqual([])
    expect(await getCommitFiles(run, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toEqual([])
  })

  test('getCommitFileDiff returns the pure per-file patch, no log preamble', async () => {
    const diff = await getCommitFileDiff(run, secondHash, 'a.txt')
    expect(diff).toContain('a.txt')
    expect(diff).toContain('+second')
    expect(diff).not.toMatch(/^commit /m)
    expect(diff).not.toMatch(/^Author:/m)
    // Bad ref / empty path / unknown file → empty string, never throws.
    expect(await getCommitFileDiff(run, 'a b', 'a.txt')).toBe('')
    expect(await getCommitFileDiff(run, secondHash, '')).toBe('')
    expect(await getCommitFileDiff(run, secondHash, 'nope.txt')).toBe('')
  })

  test('getRangeDiff(root, second) returns the changed file + a shortstat summary', async () => {
    const res = await getRangeDiff(run, rootHash, secondHash)
    expect(res.from).toBe(rootHash)
    expect(res.to).toBe(secondHash)
    expect(res.threeDot).toBe(false)
    expect(res.binary).toBe(false)
    expect(res.diff).toContain('a.txt')
    expect(res.diff).toContain('+second')
    // Pure patch — no commit-log preamble.
    expect(res.diff).not.toMatch(/^commit /m)
    // Shortstat names the touched file count + insertions.
    expect(res.stat).toContain('1 file changed')
    expect(res.stat).toContain('insertion')
  })

  test('a reversed range (second → root) shows the deletion', async () => {
    const res = await getRangeDiff(run, secondHash, rootHash)
    expect(res.diff).toContain('-second')
  })

  test('a three-dot range still resolves (merge-base symmetric diff)', async () => {
    const res = await getRangeDiff(run, rootHash, secondHash, true)
    expect(res.threeDot).toBe(true)
    expect(res.diff).toContain('+second')
  })

  test('an unsafe ref throws a typed 400 without running git', () => {
    let calls = 0
    const spy: GitRunner = async (args) => {
      calls++
      return runGit(dir, args)
    }
    expect(getRangeDiff(spy, '--evil', secondHash)).rejects.toThrow(ApiError)
    expect(calls).toBe(0)
  })

  test('an unresolvable ref surfaces a typed 409 (git refuses)', () => {
    expect(
      getRangeDiff(run, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', secondHash),
    ).rejects.toMatchObject({ status: 409 })
  })
})

/**
 * The one-spawn `git show` must print what the old two-step read printed (`diff
 * <hash>^ <hash>`, or `show --root` for a root commit) — for a merge that is the
 * diff against its FIRST parent — and an overflow must never read as "no changes".
 */
describe('getCommitShow — merge parity, mixed binary, overflow', () => {
  let dir: string
  let run: GitRunner
  let merge = ''
  let mixed = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-show-merge-'))
    run = gitRunner(dir)
    await run(['init', '-q', '-b', 'main'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    await run(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'a.txt'), 'a\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'root'])
    await run(['checkout', '-q', '-b', 'side'])
    await writeFile(join(dir, 'side.txt'), 'from side\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'side'])
    await run(['checkout', '-q', 'main'])
    await writeFile(join(dir, 'a.txt'), 'a\nmain\n')
    await run(['commit', '-q', '-am', 'main'])
    await run(['merge', '-q', '--no-edit', 'side'])
    merge = (await run(['rev-parse', 'HEAD'])).stdout.trim()
    // One binary file and one large text file in the same commit.
    await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 1, 2, 0, 255, 0, 7]))
    await writeFile(join(dir, 'big.txt'), 'line of text\n'.repeat(2_000))
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'mixed'])
    mixed = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a merge shows exactly its first-parent diff, in ONE spawn', async () => {
    let spawns = 0
    const counting: GitRunner = (...args) => {
      spawns++
      return run(...args)
    }
    const res = await getCommitShow(counting, merge)
    const twoStep = (await run(['diff', `${merge}^`, merge])).stdout
    expect(res.diff).toBe(twoStep)
    expect(res.diff).toContain('+from side')
    expect(spawns).toBe(1)
  })

  test('a commit with one binary and one text file is NOT binary', async () => {
    const res = await getCommitShow(run, mixed)
    expect(res.binary).toBe(false)
    expect(res.diff).toContain('Binary files')
    expect(res.diff).toContain('+line of text')
    expect(res.truncated).toBeUndefined()
  })

  test('an overflowing commit returns its complete leading files, flagged truncated', async () => {
    // A real git process against a tight ceiling: proves the runner's flag end to end.
    const tight: GitRunner = (args, env, timeout) => run(args, env, timeout, 4_096)
    const res = await getCommitShow(tight, mixed)
    expect(res.truncated).toBe(true)
    // big.txt sorts first and alone exceeds the ceiling, so what survives is its
    // complete lines — never an empty "this commit has no changes".
    expect(res.diff.length).toBeGreaterThan(0)
    expect(res.diff.endsWith('\n')).toBe(true)
  })

  test('an overflowing compare is a truncated result, not a 409', async () => {
    const tight: GitRunner = (args, env, timeout) => run(args, env, timeout, 4_096)
    const res = await getRangeDiff(tight, merge, mixed)
    expect(res.truncated).toBe(true)
    expect(res.diff).toContain('diff --git')
    expect(res.stat).toContain('2 files changed')
  })
})
