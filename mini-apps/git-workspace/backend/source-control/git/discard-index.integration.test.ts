import { afterAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discard } from './actions'
import { gitRunner } from './cli'

const scratch = tmpdir()
const repos: string[] = []
afterAll(async () => {
  await Promise.all(repos.map((dir) => rm(dir, { recursive: true, force: true })))
})
async function setup(commit = true) {
  const dir = await mkdtemp(join(scratch, 'discard-index-'))
  repos.push(dir)
  const run = gitRunner(dir)
  await run(['init', '-q'])
  await run(['config', 'user.name', 'Test'])
  await run(['config', 'user.email', 'test@example.invalid'])
  await mkdir(join(dir, 'src'))
  await writeFile(join(dir, 'src/keep.txt'), 'base\n')
  await writeFile(join(dir, 'src/edit.txt'), 'base\n')
  await run(['add', '.'])
  if (commit) await run(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'base'])
  return { dir, run }
}

test('folder discard preserves staged-only files and restores MM to its index content', async () => {
  const { dir, run } = await setup()
  await writeFile(join(dir, 'src/keep.txt'), 'keep staged\n')
  await writeFile(join(dir, 'src/edit.txt'), 'staged edit\n')
  await run(['add', '.'])
  const indexBefore = (await run(['write-tree'])).stdout
  await writeFile(join(dir, 'src/edit.txt'), 'unstaged edit\n')
  await writeFile(join(dir, 'src/new.txt'), 'untracked\n')
  await discard(run, ['src'])
  expect((await run(['write-tree'])).stdout).toBe(indexBefore)
  expect(await readFile(join(dir, 'src/keep.txt'), 'utf8')).toBe('keep staged\n')
  expect(await readFile(join(dir, 'src/edit.txt'), 'utf8')).toBe('staged edit\n')
  expect((await run(['status', '--porcelain'])).stdout).toBe('M  src/edit.txt\nM  src/keep.txt\n')
  await discard(run, ['src'])
  expect((await run(['write-tree'])).stdout).toBe(indexBefore)
})

test('mixed explicit tracked and untracked paths are discarded, unrelated work is kept', async () => {
  const { dir, run } = await setup()
  await writeFile(join(dir, 'src/edit.txt'), 'unstaged\n')
  await writeFile(join(dir, 'src/keep.txt'), 'unrelated\n')
  await writeFile(join(dir, 'src/new.txt'), 'untracked\n')
  await discard(run, ['src/edit.txt', 'src/new.txt'])
  expect(await readFile(join(dir, 'src/edit.txt'), 'utf8')).toBe('base\n')
  expect(await readFile(join(dir, 'src/keep.txt'), 'utf8')).toBe('unrelated\n')
  expect((await run(['status', '--porcelain'])).stdout).toBe(' M src/keep.txt\n')
})

test('unborn branch discard preserves index and restores staged additions', async () => {
  const { dir, run } = await setup(false)
  const before = (await run(['write-tree'])).stdout
  await writeFile(join(dir, 'src/edit.txt'), 'later\n')
  await discard(run, ['src/edit.txt'])
  expect(await readFile(join(dir, 'src/edit.txt'), 'utf8')).toBe('base\n')
  expect((await run(['write-tree'])).stdout).toBe(before)
})
