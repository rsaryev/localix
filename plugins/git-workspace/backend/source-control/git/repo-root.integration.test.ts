import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitBackend } from './backend'
import { gitRunner } from './cli'
import { findRepoRoot } from './repo-root'

/**
 * A session cwd that is a SUBFOLDER of the repo. Status paths are root-relative;
 * every op below used to read them relative to the cwd and miss the file.
 */
describe('git backend from a subfolder cwd', () => {
  let root: string
  let sub: string
  const backend = createGitBackend()

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sc-subdir-'))
    sub = join(root, 'sub')
    await mkdir(sub)
    const run = gitRunner(root)
    await run(['init', '-q'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    await run(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(sub, 'f.txt'), 'one\ntwo\n')
    await writeFile(join(root, 'top.txt'), 'top\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'init'])
    await writeFile(join(sub, 'f.txt'), 'one\nTWO\n')
    await writeFile(join(sub, 'new.txt'), 'brand new\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('the walk-up finds the top level without spawning git', () => {
    expect(findRepoRoot(sub)).toBe(root)
    expect(findRepoRoot(root)).toBe(root)
    // No `.git` anywhere above: the cwd comes back as given.
    expect(findRepoRoot('/')).toBe('/')
  })

  test('status paths are usable as diff and hunk targets', async () => {
    const status = await backend.getStatus(sub)
    expect(status.files.map((f) => f.path).sort()).toEqual(['sub/f.txt', 'sub/new.txt'])
    expect((await backend.getFileDiff(sub, { path: 'sub/f.txt' })).diff).toContain('+TWO')
    const untracked = await backend.getFileDiff(sub, { path: 'sub/new.txt', untracked: true })
    expect(untracked.diff).toContain('b/sub/new.txt')
    const hunks = await backend.getFileHunks(sub, 'sub/f.txt')
    expect(hunks).toHaveLength(1)
    await backend.revertHunk(sub, { path: 'sub/f.txt', index: 0, header: hunks[0]!.header })
    expect(await readFile(join(sub, 'f.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  test('stage, unstage and discard reach the root-relative path', async () => {
    await backend.stage(sub, ['sub/f.txt'])
    let file = (await backend.getStatus(sub)).files.find((f) => f.path === 'sub/f.txt')
    expect(file?.staged).toBe(true)
    await backend.unstage(sub, ['sub/f.txt'])
    file = (await backend.getStatus(sub)).files.find((f) => f.path === 'sub/f.txt')
    expect(file?.staged).toBe(false)
    await backend.discard(sub, ['sub/f.txt'])
    expect(await readFile(join(sub, 'f.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  test('line staging reads and applies the same file', async () => {
    const view = await backend.getFileDiffLines(sub, { path: 'sub/f.txt', mode: 'unstaged' })
    const added = view.lines.filter((l) => l.kind === 'add' || l.kind === 'del')
    expect(added.length).toBeGreaterThan(0)
    await backend.stageLines(sub, {
      path: 'sub/f.txt',
      lines: added.map((l) => l.index),
      diffId: view.diffId,
    })
    const staged = await backend.getFileDiff(sub, { path: 'sub/f.txt', staged: true })
    expect(staged.diff).toContain('+TWO')
  })

  test('the working diff lists every untracked file root-relative', async () => {
    await writeFile(join(root, 'elsewhere.txt'), 'outside the cwd\n')
    const diff = (await backend.getWorkingDiff(sub)).diff
    expect(diff).toContain('b/sub/new.txt')
    // `ls-files --others` from the subfolder used to list only the cwd's subtree.
    expect(diff).toContain('b/elsewhere.txt')
    expect(diff).toContain('+TWO')
  })

  test('a commit file diff resolves the root-relative name git listed', async () => {
    const hash = (await backend.getLog(sub, 1))[0]!.hash
    const files = await backend.getCommitFiles(sub, hash)
    expect(files).toContain('sub/f.txt')
    expect(await backend.getCommitFileDiff(sub, hash, 'sub/f.txt')).toContain('+one')
  })

  test('the change version stats the real file, so an mtime-only rewrite moves it', async () => {
    const before = (await backend.getStatus(sub)).changeVersion
    // Same bytes, new mtime: only a stat of the RIGHT path can see this.
    await utimes(join(sub, 'f.txt'), new Date(), new Date(Date.now() + 60_000))
    const after = (await backend.getStatus(sub)).changeVersion
    expect(after).not.toBe(before)
  })
})
