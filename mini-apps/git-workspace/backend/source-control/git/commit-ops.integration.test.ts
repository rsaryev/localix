import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkoutCommit,
  cherryPick,
  createBranchAt,
  resetToCommit,
  revertCommit,
} from './commit-ops'
import { getLog } from './log'
import { listBranches } from './branches'
import { collectStatus } from './status'
import { gitRunner, type GitRunner } from './cli'

describe('commit-ops (real git)', () => {
  let dir: string
  let run: GitRunner

  const subjects = async () => (await getLog(run, 20)).map((c) => c.subject)
  const headHash = async () => (await run(['rev-parse', 'HEAD'])).stdout.trim()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-commit-ops-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    // c1: base
    await writeFile(join(dir, 'f.txt'), 'a\n', 'utf8')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'c1 base'])
    // c2: add b
    await writeFile(join(dir, 'f.txt'), 'a\nb\n', 'utf8')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'c2 add b'])
    // c3: add c
    await writeFile(join(dir, 'f.txt'), 'a\nb\nc\n', 'utf8')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'c3 add c'])
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('revertCommit creates a new commit undoing the target (history-preserving)', async () => {
    const c3 = (await getLog(run, 20)).find((c) => c.subject === 'c3 add c')!
    await revertCommit(run, c3.hash)
    const subs = await subjects()
    expect(subs[0]).toMatch(/^Revert "c3 add c"/)
    // the tip commit is preserved; the revert removed the 'c' line it had added
    expect(subs).toContain('c3 add c')
    expect((await run(['show', 'HEAD:f.txt'])).stdout).toBe('a\nb\n')
  })

  test('resetToCommit --hard moves HEAD back and discards later commits + working tree', async () => {
    const c1 = (await getLog(run, 20)).find((c) => c.subject === 'c1 base')!
    await resetToCommit(run, c1.hash, 'hard')
    expect(await headHash()).toBe(c1.hash)
    expect(await subjects()).toEqual(['c1 base'])
    expect((await run(['show', 'HEAD:f.txt'])).stdout).toBe('a\n')
  })

  test('resetToCommit --soft moves HEAD but leaves the diff staged', async () => {
    const c1 = (await getLog(run, 20)).find((c) => c.subject === 'c1 base')!
    await resetToCommit(run, c1.hash, 'soft')
    expect(await headHash()).toBe(c1.hash)
    const status = await collectStatus(run)
    expect(status.files.some((f) => f.path === 'f.txt' && f.staged)).toBe(true)
  })

  test('checkoutCommit detaches HEAD onto the commit', async () => {
    const c2 = (await getLog(run, 20)).find((c) => c.subject === 'c2 add b')!
    await checkoutCommit(run, c2.hash)
    const status = await collectStatus(run)
    expect(status.detached).toBe(true)
    expect(status.branch).toBeNull()
  })

  test('createBranchAt makes a branch at a commit without switching to it', async () => {
    const c1 = (await getLog(run, 20)).find((c) => c.subject === 'c1 base')!
    const before = (await listBranches(run)).find((b) => b.current)?.name
    await createBranchAt(run, 'from-c1', c1.hash)
    // HEAD unchanged (still on the original branch, still at c3)
    expect((await listBranches(run)).find((b) => b.current)?.name).toBe(before)
    expect((await subjects())[0]).toBe('c3 add c')
    // the new branch points at c1
    expect((await run(['rev-parse', 'from-c1'])).stdout.trim()).toBe(c1.hash)
  })

  test('cherryPick replays a commit from another branch onto the current one', async () => {
    // Make a side branch off c1 with a distinct file, then cherry-pick it back.
    const c1 = (await getLog(run, 20)).find((c) => c.subject === 'c1 base')!
    await run(['checkout', '-q', '-b', 'side', c1.hash])
    await writeFile(join(dir, 'g.txt'), 'side\n', 'utf8')
    await run(['add', 'g.txt'])
    await run(['commit', '-qm', 'side feature'])
    const side = await headHash()
    await run(['checkout', '-q', '-'])
    await cherryPick(run, side)
    expect((await subjects())[0]).toBe('side feature')
    expect((await run(['show', 'HEAD:g.txt'])).stdout).toBe('side\n')
  })
})
