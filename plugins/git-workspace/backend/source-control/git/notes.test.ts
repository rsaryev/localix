import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyNotesRewriteConfig,
  ensureNotesRewriteConfig,
  listNotedCommits,
  readCommitNote,
  resolveHead,
  writeCommitNote,
  LOCALIX_NOTES_REF,
} from './notes'
import { gitRunner, type GitRunner } from './cli'
import type { CommitNote } from '../contracts'

/**
 * Commit provenance via git notes against a real throwaway repo. Exercises
 * write→read round-trip, the noted-set, the no-note miss, and idempotent
 * rewrite config. Follows show.test.ts style.
 */
describe('commit provenance notes', () => {
  let dir: string
  let run: GitRunner
  let notedHash = ''
  let plainHash = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-notes-'))
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
    await run(['commit', '-q', '-m', 'noted commit'])
    notedHash = (await run(['rev-parse', 'HEAD'])).stdout.trim()

    await writeFile(join(dir, 'a.txt'), 'first\nsecond\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'plain commit'])
    plainHash = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('writeCommitNote then readCommitNote returns the parsed payload', async () => {
    const note: CommitNote = {
      sessionId: 'sess-1',
      model: 'deepseek-v4-flash',
      rationale: 'fix the bug',
      createdAt: '2026-06-23T00:00:00.000Z',
    }
    await writeCommitNote(run, notedHash, note)
    const got = await readCommitNote(run, notedHash)
    expect(got).toEqual(note)
  })

  test('listNotedCommits includes the noted sha (full sha, 2nd column)', async () => {
    const noted = await listNotedCommits(run)
    expect(noted.has(notedHash)).toBe(true)
  })

  test('a commit with no note → readCommitNote null + not in the noted set', async () => {
    expect(await readCommitNote(run, plainHash)).toBeNull()
    const noted = await listNotedCommits(run)
    expect(noted.has(plainHash)).toBe(false)
  })

  test('writeCommitNote -f overwrites an existing note', async () => {
    const updated: CommitNote = { sessionId: 'sess-2', createdAt: '2026-06-23T01:00:00.000Z' }
    await writeCommitNote(run, notedHash, updated)
    expect(await readCommitNote(run, notedHash)).toEqual(updated)
  })

  test('resolveHead returns the current HEAD sha', async () => {
    expect(await resolveHead(run)).toBe(plainHash)
  })

  test('ensureNotesRewriteConfig spawns once per repo, then never again', async () => {
    let spawns = 0
    const counting: GitRunner = (...args) => {
      spawns++
      return run(...args)
    }
    const key = `${dir}#memo`
    await ensureNotesRewriteConfig(counting, key)
    const first = spawns
    await ensureNotesRewriteConfig(counting, key)
    expect(first).toBeGreaterThan(0)
    // Every commit used to re-run 2–3 `git config` spawns here.
    expect(spawns).toBe(first)
  })

  test('a failed apply is not remembered, so the next commit retries', async () => {
    const refusing: GitRunner = async () => ({ ok: false, stdout: '', stderr: 'locked', code: 1 })
    const key = `${dir}#fail`
    await ensureNotesRewriteConfig(refusing, key)
    let spawns = 0
    await ensureNotesRewriteConfig((...args) => {
      spawns++
      return run(...args)
    }, key)
    expect(spawns).toBeGreaterThan(0)
  })

  test('applyNotesRewriteConfig is idempotent (running twice does not duplicate the rewriteRef)', async () => {
    expect(await applyNotesRewriteConfig(run)).toBe(true)
    expect(await applyNotesRewriteConfig(run)).toBe(true)
    const refs = (await run(['config', '--get-all', 'notes.rewriteRef'])).stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    expect(refs.filter((r) => r === LOCALIX_NOTES_REF)).toHaveLength(1)
    expect((await run(['config', 'notes.rewriteMode'])).stdout.trim()).toBe('concatenate')
  })

  test('an unsafe ref (leading dash / whitespace) is rejected without writing/reading', async () => {
    let calls = 0
    const spy: GitRunner = async (args) => {
      calls++
      return run(args)
    }
    await writeCommitNote(spy, '--evil', { sessionId: null, createdAt: 'x' })
    expect(await readCommitNote(spy, 'a b')).toBeNull()
    expect(calls).toBe(0)
  })
})
