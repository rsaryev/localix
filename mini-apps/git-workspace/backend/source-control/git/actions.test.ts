import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addToGitignore, amend, discard, getCommitDiff, withCoAuthor } from './actions'
import { fetchRemote, pull, push } from './remote-ops'
import type { GitResult, GitRunner } from './cli'
import { ApiError } from '@localixai/mini-app-sdk/backend'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stderr: string): GitResult => ({ ok: false, stdout: '', stderr, code: 1 })

/** A GitRunner that records the args it was called with and replays a queued result. */
function fakeRunner(result: GitResult): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return { run: async (args) => (calls.push(args), result), calls }
}

/** A GitRunner whose reply depends on the git subcommand (first two args). */
function routedRunner(route: (args: string[]) => GitResult): {
  run: GitRunner
  calls: string[][]
  maxBuffers: Array<number | undefined>
} {
  const calls: string[][] = []
  const maxBuffers: Array<number | undefined> = []
  return {
    run: async (args, _extraEnv, _timeoutMs, maxBufferBytes) => {
      calls.push(args)
      maxBuffers.push(maxBufferBytes)
      return route(args)
    },
    calls,
    maxBuffers,
  }
}

// Mirrors the module-private COAUTHOR_TRAILER constant in actions.ts.
const TRAILER = 'Co-Authored-By: Localix <noreply@localix.ai>'

describe('withCoAuthor', () => {
  test('appends the trailer as its own paragraph when absent', () => {
    expect(withCoAuthor('feat: add login')).toBe(`feat: add login\n\n${TRAILER}`)
    expect(withCoAuthor('')).toBe(`\n\n${TRAILER}`)
  })

  test('trims trailing whitespace before appending the trailer', () => {
    expect(withCoAuthor('fix: bug   \n  \t')).toBe(`fix: bug\n\n${TRAILER}`)
  })

  test('is a no-op when the exact trailer is already present', () => {
    const already = `msg body\n\n${TRAILER}`
    expect(withCoAuthor(already)).toBe(already)
    // even with a trailing newline after the trailer, substring match holds
    const withNl = `msg\n\n${TRAILER}\n`
    expect(withCoAuthor(withNl)).toBe(withNl)
  })

  test('still appends ours when a DIFFERENT co-author trailer is present', () => {
    const other = 'feat: x\n\nCo-Authored-By: Other <other@example.com>'
    expect(withCoAuthor(other)).toBe(`${other}\n\n${TRAILER}`)
  })

  test('is idempotent — applying twice equals applying once', () => {
    const once = withCoAuthor('chore: tidy')
    expect(withCoAuthor(once)).toBe(once)
  })
})

describe('amend', () => {
  test('verifies HEAD then runs `git commit --amend -m <message+trailer>`', async () => {
    const { run, calls } = routedRunner((args) => (args[0] === 'rev-parse' ? ok('sha\n') : ok()))
    await amend(run, 'fix: correct typo')
    expect(calls[0]).toEqual(['rev-parse', '--verify', '--quiet', 'HEAD'])
    expect(calls[1]?.slice(0, 3)).toEqual(['commit', '--amend', '-m'])
    expect(calls[1]?.[3]).toBe(withCoAuthor('fix: correct typo'))
  })

  test('refuses on an unborn branch (no HEAD) with a 409 and never commits', async () => {
    const { run, calls } = routedRunner((args) => (args[0] === 'rev-parse' ? fail('') : ok()))
    let caught: unknown
    try {
      await amend(run, 'anything')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    // Only the rev-parse probe ran — no commit was attempted.
    expect(calls).toEqual([['rev-parse', '--verify', '--quiet', 'HEAD']])
  })

  test("surfaces git's message as a 409 when the amend itself fails", async () => {
    const { run } = routedRunner((args) =>
      args[0] === 'rev-parse' ? ok('sha\n') : fail('fatal: cannot amend'),
    )
    let caught: unknown
    try {
      await amend(run, 'x')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).message).toBe('fatal: cannot amend')
  })
})

describe('pull', () => {
  test('runs `git pull --ff-only` and resolves on success', async () => {
    const { run, calls } = fakeRunner(ok('Fast-forward\n'))
    await pull(run)
    expect(calls).toEqual([['pull', '--ff-only']])
  })

  test("surfaces git's message as a 409 ApiError on divergence", async () => {
    const { run } = fakeRunner(fail('fatal: Not possible to fast-forward, aborting.'))
    let caught: unknown
    try {
      await pull(run)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).message).toBe('fatal: Not possible to fast-forward, aborting.')
  })
})

describe('fetchRemote', () => {
  test('runs `git fetch --prune` and resolves on success', async () => {
    const { run, calls } = fakeRunner(ok(''))
    await fetchRemote(run)
    expect(calls).toEqual([['fetch', '--prune']])
  })

  test("surfaces git's message as a 409 ApiError when no remote is configured", async () => {
    const { run } = fakeRunner(fail('fatal: No remote repository specified.'))
    let caught: unknown
    try {
      await fetchRemote(run)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).message).toBe('fatal: No remote repository specified.')
  })
})

describe('getCommitDiff', () => {
  test('uses only the staged change set when the index is non-empty', async () => {
    const { run, calls, maxBuffers } = routedRunner((args) => {
      if (args.join(' ') === 'diff --cached --name-only') return ok('staged.ts\n')
      if (args.join(' ') === 'diff --cached')
        return ok('diff --git a/staged.ts b/staged.ts\n+staged')
      if (args.join(' ') === 'diff --cached --stat') return ok(' staged.ts | 1 +')
      return fail(`unexpected: ${args.join(' ')}`)
    })

    const result = await getCommitDiff(run, '/repo')

    expect(result).toEqual({
      diff: 'diff --git a/staged.ts b/staged.ts\n+staged',
      stat: ' staged.ts | 1 +',
      staged: true,
    })
    expect(calls.some((args) => args[0] === 'ls-files')).toBe(false)
    const stagedDiffCall = calls.findIndex((args) => args.join(' ') === 'diff --cached')
    const stagedStatCall = calls.findIndex((args) => args.join(' ') === 'diff --cached --stat')
    expect(maxBuffers[stagedDiffCall]).toBe(2_000_000)
    expect(maxBuffers[stagedStatCall]).toBe(512_000)
  })

  test('includes untracked files in the commit-all context when nothing is staged', async () => {
    const { run, calls, maxBuffers } = routedRunner((args) => {
      const command = args.join(' ')
      if (command === 'diff --cached --name-only') return ok('')
      if (command === 'rev-parse --verify --quiet HEAD') return ok('abc123\n')
      if (command === 'diff HEAD') return ok('diff --git a/tracked.ts b/tracked.ts\n+tracked')
      if (command === 'diff HEAD --stat') return ok(' tracked.ts | 1 +')
      if (command === 'ls-files --others --exclude-standard -z') return ok('new.ts\0')
      if (command === 'diff --no-index -- /dev/null new.ts') {
        return {
          ...fail(''),
          stdout: 'diff --git a/dev/null b/new.ts\n--- /dev/null\n+++ b/new.ts\n+new',
        }
      }
      return fail(`unexpected: ${command}`)
    })

    const result = await getCommitDiff(run, '/repo')

    expect(result.staged).toBe(false)
    expect(result.diff).toContain('diff --git a/tracked.ts b/tracked.ts')
    expect(result.diff).toContain('diff --git a/dev/null b/new.ts')
    const workingStatCall = calls.findIndex((args) => args.join(' ') === 'diff HEAD --stat')
    expect(maxBuffers[workingStatCall]).toBe(512_000)
  })

  test('keeps a captured tracked diff prefix when git exceeds its output buffer', async () => {
    // The ceiling cut the last line mid-way; only complete lines survive.
    const complete = 'diff --git a/large.ts b/large.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n'
    const { run } = routedRunner((args) => {
      const command = args.join(' ')
      if (command === 'diff --cached --name-only') return ok('')
      if (command === 'rev-parse --verify --quiet HEAD') return ok('abc123\n')
      if (command === 'diff HEAD') {
        return { ...fail('stdout maxBuffer exceeded'), stdout: `${complete}+ne`, truncated: true }
      }
      if (command === 'diff HEAD --stat') return ok(' large.ts | 2 +-')
      if (command === 'ls-files --others --exclude-standard -z') return ok('')
      return fail(`unexpected: ${command}`)
    })

    const result = await getCommitDiff(run, '/repo')

    expect(result.diff).toBe(complete)
    expect(result.staged).toBe(false)
  })

  test('keeps a captured staged diff prefix when git exceeds its output buffer', async () => {
    const partial = 'diff --git a/large.ts b/large.ts\n@@ -1 +1 @@\n-old\n+new'
    const { run } = routedRunner((args) => {
      const command = args.join(' ')
      if (command === 'diff --cached --name-only') return ok('large.ts\n')
      if (command === 'diff --cached') {
        return { ...fail('stdout maxBuffer exceeded'), stdout: partial }
      }
      if (command === 'diff --cached --stat') return ok(' large.ts | 2 +-')
      return fail(`unexpected: ${command}`)
    })

    const result = await getCommitDiff(run, '/repo')

    expect(result.diff).toBe(partial)
    expect(result.staged).toBe(true)
  })

  test('recovers salient and spread staged files after the combined diff cap is exceeded', async () => {
    const paths = [
      ...Array.from({ length: 24 }, (_, index) => `src/feature-${index}.ts`),
      ...Array.from({ length: 6 }, (_, index) => `tests/feature-${index}.test.ts`),
      ...Array.from({ length: 6 }, (_, index) => `generated/chunk-${index}.snap`),
    ]
    const { run, calls, maxBuffers } = routedRunner((args) => {
      const command = args.join(' ')
      if (command === 'diff --cached --name-only') return ok(`${paths.join('\n')}\n`)
      if (command === 'diff --cached') {
        return {
          ...fail('stdout maxBuffer exceeded'),
          stdout: 'diff --git a/src/feature-0.ts b/src/feature-0.ts\n+prefix only',
        }
      }
      if (command === 'diff --cached --stat') return ok('36 files changed')
      if (command === 'diff --cached --numstat -z') {
        return ok(
          `${paths
            .map((path) => `${path === 'src/feature-17.ts' ? 900 : 2}\t1\t${path}`)
            .join('\0')}\0`,
        )
      }
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--') {
        const path = args[3]!
        return ok(`diff --git a/${path} b/${path}\n-old\n+new`)
      }
      return fail(`unexpected: ${command}`)
    })

    const result = await getCommitDiff(run, '/repo')
    const pathCalls = calls
      .map((args, index) => ({ args, maxBuffer: maxBuffers[index] }))
      .filter(({ args }) => args[2] === '--')

    expect(pathCalls).toHaveLength(24)
    expect(pathCalls.every(({ maxBuffer }) => maxBuffer === 96_000)).toBe(true)
    expect(result.diff).toContain('diff --git a/src/feature-17.ts')
    expect(result.diff).toMatch(/^diff --git a\/tests\//m)
    expect(result.diff).not.toMatch(/^diff --git a\/generated\//m)
  })

  test('bounds and spreads untracked patch capture for a very broad commit-all', async () => {
    const paths = Array.from({ length: 80 }, (_, index) => `new-${index}.ts`)
    const { run, calls, maxBuffers } = routedRunner((args) => {
      const command = args.join(' ')
      if (command === 'diff --cached --name-only') return ok('')
      if (command === 'rev-parse --verify --quiet HEAD') return ok('abc123\n')
      if (command === 'diff HEAD') return ok('')
      if (command === 'diff HEAD --stat') return ok('')
      if (command === 'ls-files --others --exclude-standard -z') return ok(`${paths.join('\0')}\0`)
      if (args[0] === 'diff' && args[1] === '--no-index') {
        const path = args.at(-1)!
        const lines = Array.from(
          { length: 2_000 },
          (_, index) => `+line ${index} ${'x'.repeat(40)}`,
        )
        return { ...fail(''), stdout: `diff --git a/dev/null b/${path}\n${lines.join('\n')}` }
      }
      return fail(`unexpected: ${command}`)
    })

    const result = await getCommitDiff(run, '/repo')
    const noIndexCalls = calls.filter((args) => args[1] === '--no-index')

    expect(noIndexCalls).toHaveLength(48)
    expect(noIndexCalls[0]?.at(-1)).toEndWith('new-0.ts')
    expect(noIndexCalls.at(-1)?.at(-1)).toEndWith('new-79.ts')
    expect(result.diff.length).toBeLessThanOrEqual(48 * 64_000 + 47)
    expect(result.diff).toContain('… untracked patch capture omitted …')
    expect(result.diff).toContain('+line 0 ')
    expect(result.diff).toContain('+line 1999 ')
    const trackedCall = calls.findIndex((args) => args.join(' ') === 'diff HEAD')
    expect(maxBuffers[trackedCall]).toBe(2_000_000)
    for (const [index, args] of calls.entries()) {
      if (args[1] === '--no-index') expect(maxBuffers[index]).toBe(96_000)
    }
  })
})

describe('addToGitignore', () => {
  async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'gitignore-'))
    try {
      await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test('creates .gitignore with a trailing newline when absent', async () => {
    await withTmp(async (dir) => {
      await addToGitignore(dir, ['/dist', '/logs/'])
      expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('/dist\n/logs/\n')
    })
  })

  test('appends only missing patterns, preserving existing content', async () => {
    await withTmp(async (dir) => {
      await writeFile(join(dir, '.gitignore'), 'node_modules\n/dist\n', 'utf8')
      await addToGitignore(dir, ['/dist', '/coverage/'])
      expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(
        'node_modules\n/dist\n/coverage/\n',
      )
    })
  })

  test('adds a separating newline when the file lacks a trailing one', async () => {
    await withTmp(async (dir) => {
      await writeFile(join(dir, '.gitignore'), '/dist', 'utf8')
      await addToGitignore(dir, ['/logs/'])
      expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('/dist\n/logs/\n')
    })
  })

  test('is a no-op when every pattern is already present', async () => {
    await withTmp(async (dir) => {
      await writeFile(join(dir, '.gitignore'), '/dist\n', 'utf8')
      await addToGitignore(dir, ['/dist'])
      expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('/dist\n')
    })
  })
})

describe('push', () => {
  test('a plain push is just `git push`', async () => {
    const { run, calls } = fakeRunner(ok())
    await push(run)
    expect(calls).toEqual([['push']])
  })

  test('a branch with no upstream gets one created', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      return calls.length === 1
        ? fail('fatal: The current branch x has no upstream branch.\n')
        : ok()
    }
    await push(run)
    expect(calls).toEqual([['push'], ['push', '-u', 'origin', 'HEAD']])
  })

  test('force uses --force-with-lease, NEVER a bare --force', async () => {
    const { run, calls } = fakeRunner(ok())
    await push(run, { force: true })
    expect(calls[0]).toEqual(['push', '--force-with-lease'])
    expect(calls.flat()).not.toContain('--force')
  })

  test('a rejected non-fast-forward gets its own code so the UI can offer the retry', async () => {
    const { run } = fakeRunner(fail('! [rejected] main -> main (non-fast-forward)\n'))
    let caught: unknown
    try {
      await push(run)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_push_rejected')
  })

  test('a rejected FORCE push is a plain failure — there is no further retry to offer', async () => {
    const { run } = fakeRunner(fail('! [rejected] main -> main (stale info)\n'))
    let caught: unknown
    try {
      await push(run, { force: true })
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_push_failed')
  })

  test('an auth failure stays a plain failure', async () => {
    const { run } = fakeRunner(fail('fatal: Authentication failed\n'))
    let caught: unknown
    try {
      await push(run)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_push_failed')
  })
})

describe('discard', () => {
  const run = (restore: GitResult, clean: GitResult = ok()) =>
    routedRunner((args) =>
      args[0] === 'ls-files' ? ok('a.txt\0') : args[0] === 'restore' ? restore : clean,
    ).run

  test('an untracked path is cleaned without attempting restore', async () => {
    const runner = routedRunner((args) => (args[0] === 'ls-files' ? ok('') : ok()))
    await discard(runner.run, ['new.txt'])
    expect(runner.calls.map((args) => args[0])).toEqual(['ls-files', 'clean'])
  })

  test('a discard that lost index.lock THROWS, so the lock retry can see it', async () => {
    // Swallowed, this answered success while the changes were still on disk.
    const locked = fail("fatal: Unable to create '/r/.git/index.lock': File exists.")
    const caught = await discard(run(locked), ['a.txt']).catch((err: unknown) => err)
    expect((caught as ApiError).code).toBe('git_discard_failed')
    expect((caught as ApiError).message).toContain('index.lock')
  })

  test('a failed clean is reported, not dropped', async () => {
    const caught = await discard(run(ok(), fail('warning: failed to remove x')), ['x']).catch(
      (err: unknown) => err,
    )
    expect((caught as ApiError).code).toBe('git_discard_failed')
  })
})
