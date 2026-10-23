import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitRunner } from './cli'
import { getBranchDiff, getStagedDiff } from './scope-diff'

describe('scope diffs against real git', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-scope-'))
    const run = gitRunner(dir)
    await run(['init', '-q', '-b', 'main'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    await run(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'a.txt'), 'a\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'root'])
    await run(['branch', 'feature'])
    await run(['checkout', '-q', 'feature'])
    await writeFile(join(dir, 'f.txt'), 'feature work\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'feature'])
    await writeFile(join(dir, 'a.txt'), 'staged change\n')
    await run(['add', 'a.txt'])
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a branch without upstream diffs against the local trunk', async () => {
    const res = await getBranchDiff(dir, 'feature')
    expect(res?.base).toBe('main')
    expect(res?.diff).toContain('+feature work')
    expect(res?.truncated).toBe(false)
  })

  test("a branch's own upstream wins over the trunk", async () => {
    await gitRunner(dir)(['branch', '--track', 'child', 'feature'])
    expect((await getBranchDiff(dir, 'child'))?.base).toBe('feature')
  })

  test('the trunk itself has no distinct base', async () => {
    expect(await getBranchDiff(dir, 'main')).toBeNull()
  })

  test('an unsafe branch name never reaches git', async () => {
    expect(await getBranchDiff(dir, '--output=/tmp/x')).toBeNull()
  })

  test('the staged set reports its patch and whether it is whole', async () => {
    expect(await getStagedDiff(dir)).toMatchObject({ truncated: false })
    expect((await getStagedDiff(dir)).diff).toContain('+staged change')
  })
})
