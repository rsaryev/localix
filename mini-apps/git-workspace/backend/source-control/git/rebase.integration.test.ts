import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiError } from '@localixai/mini-app-sdk/backend'
import { fixupInto, interactiveRebase, rebaseOnto, readRebaseState, rewordCommit } from './rebase'
import { getLog } from './log'
import { gitRunner, type GitRunner } from './cli'

describe('rebase family (real git repo)', () => {
  let dir: string
  let run: GitRunner

  const bySubject = async (sub: string) => {
    const c = (await getLog(run, 50)).find((x) => x.subject === sub)
    if (!c) throw new Error(`no commit ${sub}`)
    return c
  }
  const subjects = async () => (await getLog(run, 50)).map((c) => c.subject)
  const count = async () => (await getLog(run, 50)).length

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-rebase-test-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    // Each commit touches a DISTINCT file so reorder/squash/drop never conflict.
    for (const [file, subject] of [
      ['a.txt', 'c1 base'],
      ['b.txt', 'c2 add b'],
      ['c.txt', 'c3 add c'],
    ] as const) {
      await writeFile(join(dir, file), `${file}\n`, 'utf8')
      await run(['add', file])
      await run(['commit', '-qm', subject])
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('interactiveRebase reorders two commits', async () => {
    const c2 = await bySubject('c2 add b')
    const c3 = await bySubject('c3 add c')
    // Apply order oldest-first, swapped: c3 then c2.
    await interactiveRebase(run, dir, c2.hash, [
      { hash: c3.hash, action: 'pick' },
      { hash: c2.hash, action: 'pick' },
    ])
    // Newest-first log: c2 sits above c3 now.
    expect(await subjects()).toEqual(['c2 add b', 'c3 add c', 'c1 base'])
    // Both files survive.
    expect((await run(['cat-file', '-e', 'HEAD:b.txt'])).ok).toBe(true)
    expect((await run(['cat-file', '-e', 'HEAD:c.txt'])).ok).toBe(true)
  })

  test('interactiveRebase squashes two commits into one', async () => {
    const c2 = await bySubject('c2 add b')
    const c3 = await bySubject('c3 add c')
    await interactiveRebase(run, dir, c2.hash, [
      { hash: c2.hash, action: 'pick' },
      { hash: c3.hash, action: 'squash' },
    ])
    expect(await count()).toBe(2)
    // Both files fold into the single combined commit at HEAD.
    expect((await run(['cat-file', '-e', 'HEAD:b.txt'])).ok).toBe(true)
    expect((await run(['cat-file', '-e', 'HEAD:c.txt'])).ok).toBe(true)
  })

  test('interactiveRebase drops a commit (and its change)', async () => {
    const c2 = await bySubject('c2 add b')
    const c3 = await bySubject('c3 add c')
    await interactiveRebase(run, dir, c2.hash, [
      { hash: c2.hash, action: 'drop' },
      { hash: c3.hash, action: 'pick' },
    ])
    expect(await subjects()).toEqual(['c3 add c', 'c1 base'])
    // b.txt is gone.
    expect((await run(['cat-file', '-e', 'HEAD:b.txt'])).ok).toBe(false)
  })

  test('interactiveRebase rewords a commit message', async () => {
    const c2 = await bySubject('c2 add b')
    const c3 = await bySubject('c3 add c')
    await interactiveRebase(run, dir, c2.hash, [
      { hash: c2.hash, action: 'reword', message: 'c2 REWORDED' },
      { hash: c3.hash, action: 'pick' },
    ])
    const subs = await subjects()
    expect(subs).toContain('c2 REWORDED')
    expect(subs).toContain('c3 add c')
    expect(subs).not.toContain('c2 add b')
  })

  test('rewordCommit amends HEAD directly (fast path)', async () => {
    const c3 = await bySubject('c3 add c')
    await rewordCommit(run, dir, c3.hash, 'c3 RENAMED')
    expect((await subjects())[0]).toBe('c3 RENAMED')
    expect(await count()).toBe(3)
  })

  test('rewordCommit rewrites an older commit via rebase', async () => {
    const c2 = await bySubject('c2 add b')
    await rewordCommit(run, dir, c2.hash, 'c2 RENAMED')
    const subs = await subjects()
    expect(subs).toContain('c2 RENAMED')
    expect(subs).toContain('c3 add c')
    expect(await count()).toBe(3)
  })

  test('fixupInto folds the staged change into an older commit', async () => {
    const c1 = await bySubject('c1 base')
    // Stage a NEW file to be folded into the root commit.
    await writeFile(join(dir, 'a.txt'), 'a.txt\nextra\n', 'utf8')
    await run(['add', 'a.txt'])
    await fixupInto(run, dir, c1.hash)
    expect(await count()).toBe(3) // no new commit added — folded in
    expect(await subjects()).toEqual(['c3 add c', 'c2 add b', 'c1 base'])
    // The oldest commit now carries the folded content.
    const c1new = await bySubject('c1 base')
    expect((await run(['show', `${c1new.hash}:a.txt`])).stdout).toBe('a.txt\nextra\n')
  })

  test('fixupInto refuses when nothing is staged', async () => {
    const c1 = await bySubject('c1 base')
    expect(fixupInto(run, dir, c1.hash)).rejects.toMatchObject({
      code: 'git_rebase_nothing_staged',
    })
  })

  test('interactiveRebase refuses a dirty working tree', async () => {
    const c2 = await bySubject('c2 add b')
    const c3 = await bySubject('c3 add c')
    await writeFile(join(dir, 'a.txt'), 'a.txt\ndirty\n', 'utf8') // unstaged tracked change
    expect(
      interactiveRebase(run, dir, c2.hash, [
        { hash: c2.hash, action: 'pick' },
        { hash: c3.hash, action: 'pick' },
      ]),
    ).rejects.toMatchObject({ code: 'git_rebase_dirty' })
  })

  test('interactiveRebase rejects a todo that omits a commit in range', async () => {
    const c2 = await bySubject('c2 add b')
    let caught: unknown
    try {
      await interactiveRebase(run, dir, c2.hash, [{ hash: c2.hash, action: 'pick' }])
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_rebase_range')
  })

  test('readRebaseState is undefined on a clean repo', async () => {
    expect(await readRebaseState(run, dir)).toBeUndefined()
  })

  test('rebaseOnto replays the current branch onto a base', async () => {
    // Branch off c1, add a commit, then rebase it onto the main tip (c3).
    const c1 = await bySubject('c1 base')
    const c3 = await bySubject('c3 add c')
    await run(['checkout', '-q', '-b', 'feat', c1.hash])
    await writeFile(join(dir, 'feat.txt'), 'feat\n', 'utf8')
    await run(['add', 'feat.txt'])
    await run(['commit', '-qm', 'feat work'])
    await rebaseOnto(run, dir, c3.hash)
    // feat now sits on top of c3 → all four files reachable.
    for (const f of ['a.txt', 'b.txt', 'c.txt', 'feat.txt']) {
      expect((await run(['cat-file', '-e', `HEAD:${f}`])).ok).toBe(true)
    }
  })
})
