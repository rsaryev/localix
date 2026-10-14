import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@localixai/plugin-sdk/backend'
import { bisectMark, bisectReset, bisectStart, getBisectState, parseBisectOutput } from './bisect'
import { gitRunner, type GitRunner } from './cli'

describe('parseBisectOutput (pure)', () => {
  test('parses the progress line (plural)', () => {
    const r = parseBisectOutput(
      'Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[abc123] c4',
    )
    expect(r.revisionsLeft).toBe(3)
    expect(r.stepsLeft).toBe(2)
    expect(r.firstBadSha).toBeUndefined()
  })

  test('parses the singular progress line (1 revision / 1 step)', () => {
    const r = parseBisectOutput(
      'Bisecting: 1 revision left to test after this (roughly 1 step)\n[def] c6',
    )
    expect(r.revisionsLeft).toBe(1)
    expect(r.stepsLeft).toBe(1)
  })

  test('parses the 0-remaining progress line', () => {
    const r = parseBisectOutput(
      'Bisecting: 0 revisions left to test after this (roughly 0 steps)\n[x] c5',
    )
    expect(r.revisionsLeft).toBe(0)
    expect(r.stepsLeft).toBe(0)
  })

  test('parses the terminal first-bad-commit verdict', () => {
    const sha = '6404b511ecb45b806d0018b7266108d5aa097298'
    const r = parseBisectOutput(
      `${sha} is the first bad commit\ncommit ${sha}\nAuthor: t <t@t.co>\n`,
    )
    expect(r.firstBadSha).toBe(sha)
    expect(r.revisionsLeft).toBeUndefined()
  })

  test('returns empty for unrecognized output', () => {
    expect(parseBisectOutput('some other git chatter')).toEqual({})
  })
})

describe('bisect (real git repo)', () => {
  let dir: string
  let run: GitRunner
  /** Full sha of each commit c1..c8 (index 0 = c1). */
  let shas: string[]

  const headHash = async () => (await run(['rev-parse', 'HEAD'])).stdout.trim()
  const currentBranch = async () => (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-bisect-'))
    run = gitRunner(dir)
    await run(['init', '-q', '-b', 'main'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    shas = []
    // Linear history c1..c8. The regression (a "BUG" marker) is introduced at c5.
    for (let i = 1; i <= 8; i++) {
      const content = i >= 5 ? `line${i}\nBUG\n` : `line${i}\n`
      await writeFile(join(dir, 'f.txt'), content, 'utf8')
      await run(['add', 'f.txt'])
      await run(['commit', '-qm', `c${i}`])
      shas.push(await headHash())
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('getBisectState is undefined when no bisect is running', async () => {
    expect(await getBisectState(run, dir)).toBeUndefined()
  })

  test('start marks a bisect in progress and reports the current commit', async () => {
    const bad = shas[7]! // c8
    const good = shas[0]! // c1
    const state = await bisectStart(run, dir, bad, good)
    expect(state.bisecting).toBe(true)
    // With both bounds known, git checks out a midpoint to test.
    expect(state.current?.hash).toBeDefined()
    expect(state.revisionsLeft).toBeGreaterThanOrEqual(0)
    // Status detection agrees a bisect is underway.
    expect((await getBisectState(run, dir))?.bisecting).toBe(true)
  })

  test('marking good/bad converges on the first bad commit (c5), then reset restores the branch', async () => {
    const badCommit = shas[4]! // c5 — the first commit carrying the BUG
    let state = await bisectStart(run, dir, shas[7]!, shas[0]!) // bad=c8, good=c1

    // Test whatever commit git checked out and mark it, until the verdict lands.
    for (let guard = 0; guard < 12 && !state.firstBadCommit; guard++) {
      const head = await headHash()
      const introducesBug = (await run(['show', `${head}:f.txt`])).stdout.includes('BUG')
      state = await bisectMark(run, dir, introducesBug ? 'bad' : 'good')
    }

    expect(state.firstBadCommit).toBeDefined()
    expect(state.firstBadCommit?.hash).toBe(badCommit)
    // Bisect is still "started" until reset — getBisectState reports the culprit too.
    expect((await getBisectState(run, dir))?.firstBadCommit?.hash).toBe(badCommit)

    await bisectReset(run, dir)
    expect(await getBisectState(run, dir)).toBeUndefined()
    expect(await currentBranch()).toBe('main')
    expect(await headHash()).toBe(shas[7]!) // back at the branch tip (c8)
  })

  test('skip advances without a verdict', async () => {
    await bisectStart(run, dir, shas[7]!, shas[0]!)
    const state = await bisectMark(run, dir, 'skip')
    expect(state.bisecting).toBe(true)
    await bisectReset(run, dir)
  })

  test('bisectMark refuses when no bisect is running', async () => {
    let caught: unknown
    try {
      await bisectMark(run, dir, 'good')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('git_bisect_not_running')
  })

  test('bisectStart with a bad ref that does not exist fails with git_bisect_failed', async () => {
    let caught: unknown
    try {
      await bisectStart(run, dir, 'nonexistentref')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('git_bisect_failed')
  })
})
