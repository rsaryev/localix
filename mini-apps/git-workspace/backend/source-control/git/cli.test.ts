import { afterEach, describe, expect, jest, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_GIT_TIMEOUT_MS,
  NETWORK_GIT_TIMEOUT_MS,
  __setGitSpawnForTest,
  firstLine,
  type GitExecOutcome,
  type GitSpawn,
  resolveGitTimeoutMs,
  runGit,
} from './cli'
import { GIT_LOCAL_ENV_VARS, gitHardenedEnv } from './git-env'

describe('firstLine', () => {
  test('returns the only line, trimmed, when there are no newlines', () => {
    expect(firstLine('hello world')).toBe('hello world')
    expect(firstLine('  padded  ')).toBe('padded')
  })

  test('returns the first NON-EMPTY trimmed line, skipping blank leaders', () => {
    expect(firstLine('  \n  second line')).toBe('second line')
    expect(firstLine('\n\n\nfourth line')).toBe('fourth line')
    expect(firstLine('line1\nline2\nline3')).toBe('line1')
  })

  test('trims the returned line (incl. a stray \\r from CRLF input)', () => {
    expect(firstLine('  spaced  \nnext')).toBe('spaced')
    expect(firstLine('a\r\nb')).toBe('a')
  })

  test('empty or all-whitespace input yields an empty string', () => {
    expect(firstLine('')).toBe('')
    expect(firstLine('   ')).toBe('')
    expect(firstLine('\n\n  \n\t')).toBe('')
  })
})

describe('resolveGitTimeoutMs', () => {
  test('network subcommands get the long network ceiling, never unbounded', () => {
    // Unbounded, a remote that stopped answering held the per-repo write queue forever.
    for (const sub of ['push', 'pull', 'fetch', 'clone']) {
      expect(resolveGitTimeoutMs([sub])).toBe(NETWORK_GIT_TIMEOUT_MS)
    }
    expect(NETWORK_GIT_TIMEOUT_MS).toBeGreaterThan(DEFAULT_GIT_TIMEOUT_MS)
  })

  test('local subcommands get the default deadline', () => {
    expect(resolveGitTimeoutMs(['status'])).toBe(DEFAULT_GIT_TIMEOUT_MS)
    expect(resolveGitTimeoutMs(['log', '--oneline'])).toBe(DEFAULT_GIT_TIMEOUT_MS)
    // `stash push` is a LOCAL op — args[0] is 'stash', not the network 'push'.
    expect(resolveGitTimeoutMs(['stash', 'push', '-u'])).toBe(DEFAULT_GIT_TIMEOUT_MS)
  })

  test('an explicit value wins; explicit 0 disables', () => {
    expect(resolveGitTimeoutMs(['fetch'], 5_000)).toBe(5_000)
    expect(resolveGitTimeoutMs(['status'], 0)).toBe(0)
    expect(resolveGitTimeoutMs(['status'], -1)).toBe(0)
  })
})

describe('runGit wall-clock timeout', () => {
  afterEach(() => __setGitSpawnForTest(null))

  test('kills cancelled context reads and never spawns an already cancelled read', async () => {
    let spawns = 0
    let kills = 0
    __setGitSpawnForTest(() => {
      spawns++
      let resolve!: (result: GitExecOutcome) => void
      const done = new Promise<GitExecOutcome>((finish) => {
        resolve = finish
      })
      return {
        done,
        child: {
          kill: () => {
            kills++
            resolve({ err: null, stdout: 'stale diff', stderr: '' })
            return true
          },
        },
      }
    })
    const controller = new AbortController()
    const pending = runGit('/repo', ['diff'], undefined, undefined, undefined, controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 130, stdout: '' })
    expect(
      await runGit('/repo', ['diff'], undefined, undefined, undefined, controller.signal),
    ).toMatchObject({ code: 130 })
    expect(spawns).toBe(1)
    expect(kills).toBe(1)
  })

  test('honors a tighter per-call process output ceiling', async () => {
    let receivedMaxBuffer = 0
    const immediateSpawn: GitSpawn = (_args, opts) => {
      receivedMaxBuffer = opts.maxBuffer
      return {
        child: { kill: () => true },
        done: Promise.resolve({ err: null, stdout: 'ok', stderr: '' }),
      }
    }
    __setGitSpawnForTest(immediateSpawn)

    const result = await runGit('/repo', ['diff'], undefined, undefined, 96_000)

    expect(result.ok).toBe(true)
    expect(receivedMaxBuffer).toBe(96_000)
  })

  test('an output overflow is flagged truncated and keeps the captured prefix', async () => {
    // What execFile reports when stdout outgrows maxBuffer: a string code, and the
    // bytes captured so far on the callback's stdout.
    __setGitSpawnForTest(() => ({
      child: { kill: () => true },
      done: Promise.resolve({
        err: Object.assign(new RangeError('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        }),
        stdout: 'diff --git a/a b/a\n+kept',
        stderr: '',
      }),
    }))
    const res = await runGit('/repo', ['diff'])
    expect(res).toMatchObject({ ok: false, truncated: true, stdout: 'diff --git a/a b/a\n+kept' })
  })

  test('an ordinary git failure is NOT flagged truncated', async () => {
    __setGitSpawnForTest(() => ({
      child: { kill: () => true },
      done: Promise.resolve({
        err: Object.assign(new Error('exit 128'), { code: 128 }),
        stdout: '',
        stderr: 'fatal: bad revision',
      }),
    }))
    const res = await runGit('/repo', ['diff', 'nope'])
    expect(res.ok).toBe(false)
    expect(res.code).toBe(128)
    expect(res.truncated).toBeUndefined()
  })

  test('kills a hung git and returns timedOut within the deadline', async () => {
    let killed = false
    // A spawn that NEVER settles on its own — only when killed, mirroring how
    // execFile fires its callback (killed:true) once we SIGKILL a wedged child.
    const hangingSpawn: GitSpawn = () => {
      let resolveDone!: (o: GitExecOutcome) => void
      const done = new Promise<GitExecOutcome>((res) => {
        resolveDone = res
      })
      return {
        child: {
          kill: () => {
            killed = true
            resolveDone({
              err: Object.assign(new Error('Killed'), { killed: true }),
              stdout: '',
              stderr: '',
            })
            return true
          },
        },
        done,
      }
    }
    __setGitSpawnForTest(hangingSpawn)

    const start = Date.now()
    // Watchdog: if the timeout/kill is ever removed, `done` never resolves and
    // `runGit` never returns — this makes the mutation FAIL fast (red) instead of
    // hanging the whole suite forever.
    const res = await Promise.race([
      runGit('/repo', ['status'], undefined, 50),
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error('runGit never returned — wall-clock timeout/kill is missing')),
          2_000,
        ),
      ),
    ])

    expect(killed).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.timedOut).toBe(true)
    expect(res.code).toBe(124)
    expect(res.stderr).toContain('timed out')
    // Proves the 50ms deadline fired — not the 2s watchdog.
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  test('does NOT kill a network op (push/pull/fetch run unbounded)', async () => {
    let killed = false
    let resolveDone!: (o: GitExecOutcome) => void
    const slowNetworkSpawn: GitSpawn = () => {
      const done = new Promise<GitExecOutcome>((res) => {
        resolveDone = res
      })
      return {
        child: {
          kill: () => {
            killed = true
            return true
          },
        },
        done,
      }
    }
    __setGitSpawnForTest(slowNetworkSpawn)

    // No explicit timeout → a network subcommand gets no deadline.
    jest.useFakeTimers()
    const pending = runGit('/repo', ['fetch', '--prune'])
    // Past the local default deadline, a wrongly-armed timer would have fired by now.
    jest.advanceTimersByTime(DEFAULT_GIT_TIMEOUT_MS * 2)
    jest.useRealTimers()
    expect(killed).toBe(false)

    // Let it complete so we don't leak a pending promise.
    resolveDone({ err: null, stdout: 'ok', stderr: '' })
    const res = await pending
    expect(res.ok).toBe(true)
    expect(res.timedOut).toBeUndefined()
  })
})

describe('repository-locating environment', () => {
  test('matches the set git itself clears before entering another repository', () => {
    const fromGit = execFileSync('git', ['rev-parse', '--local-env-vars'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
      .split('\n')
      .filter(Boolean)
    expect([...GIT_LOCAL_ENV_VARS].sort()).toEqual(expect.arrayContaining(fromGit.sort()))
  })

  test('an inherited GIT_DIR never redirects a call away from its cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-git-env-'))
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE }
    try {
      // What a hook in another repository exports to everything it starts.
      process.env.GIT_DIR = join(root, 'elsewhere.git')
      process.env.GIT_INDEX_FILE = join(root, 'elsewhere.index')
      for (const key of GIT_LOCAL_ENV_VARS) expect(gitHardenedEnv()[key]).toBeUndefined()
      const repo = join(root, 'repo')
      expect((await runGit(root, ['init', '-q', repo])).ok).toBe(true)
      const top = await runGit(repo, ['rev-parse', '--show-toplevel'])
      expect(top.stdout.trim()).toEndWith('/repo')
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
