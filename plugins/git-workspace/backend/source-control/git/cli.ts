/**
 * Low-level git process layer. Knows nothing about source-control domain types —
 * it just runs `git` in a directory and hands back the raw streams. `runGit`
 * never rejects: a non-zero exit (e.g. `git diff --no-index`, which exits 1 when
 * differences exist) resolves with `ok:false` and the captured stdout/stderr, so
 * callers decide what a failure means.
 *
 * Every invocation is bounded by a WALL-CLOCK timeout (Release It!, "Explicit
 * timeouts and no infinite waits"): a wedged local git — an index/`.git` lock, a
 * stuck fs (NFS/D-state), a hook or helper blocked on /dev/tty despite the
 * hardened env — would otherwise leave the promise (and the HTTP route awaiting
 * it) pending forever. On the deadline we SIGKILL the child, await its reap (no
 * zombie), and resolve with `ok:false, timedOut:true` — still never rejecting.
 * NETWORK subcommands (push/pull/fetch/clone) get a far longer ceiling instead
 * of the local default: a slow remote is not a wedge, but a remote that stopped
 * answering is — and these run inside the per-repo write queue, so an unbounded
 * one blocked every later stage, commit and discard on that repo until restart.
 */
import { execFile, type ExecFileOptions } from 'node:child_process'

import { gitHardenedEnv } from './git-env'

/** Cap on a single git invocation's output (large diffs/status of huge trees). */
const GIT_MAX_BUFFER = 8_000_000

/**
 * Default wall-clock cap for LOCAL git operations (status/log/diff/show/stage/
 * commit/scripted-rebase/…). Generous enough that a legitimate interactive-scale
 * git never trips it, tight enough that a wedged one surfaces an error instead of
 * hanging the route. Exported so callers/tests can reason about the default.
 */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000

/**
 * Ceiling for a NETWORK operation. The real stall detector is git's own
 * low-speed abort (see {@link gitHardenedEnv}), which leaves a slow-but-moving
 * transfer alone; this is the backstop for what that cannot see — a hung
 * pre-push hook, an SSH remote that accepts the connection and never answers.
 */
export const NETWORK_GIT_TIMEOUT_MS = 10 * 60_000

/**
 * Subcommands that talk to a remote get {@link NETWORK_GIT_TIMEOUT_MS}: a large transfer must
 * not die on a local clock. Keyed on `args[0]`, so `stash push` stays a local op.
 */
const NETWORK_SUBCOMMANDS = new Set(['push', 'pull', 'fetch', 'clone'])

/** An explicit per-call timeout wins (`0` = disable); else the network or the local default. */
export function resolveGitTimeoutMs(args: string[], explicit?: number): number {
  if (explicit !== undefined) return Math.max(0, explicit)
  return NETWORK_SUBCOMMANDS.has(args[0] ?? '') ? NETWORK_GIT_TIMEOUT_MS : DEFAULT_GIT_TIMEOUT_MS
}

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  /** Process exit code (0 on success, best-effort 1 on spawn failure, 124 on timeout). */
  code: number
  /** Set when the invocation was killed on its wall-clock deadline (not a git failure). */
  timedOut?: boolean
  /**
   * Set when the output outgrew the capture ceiling. Without it an overflowing diff looked like
   * a plain failure and rendered as "no changes"; with it `stdout` is known to be a PREFIX.
   */
  truncated?: boolean
}

/** The error code execFile (Node and Bun alike) reports when output exceeds `maxBuffer`. */
const MAX_BUFFER_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

/** Options handed to the spawner. `stdio` is honored by execFile at runtime but absent from its TS types. */
interface GitExecOpts {
  cwd: string
  env: NodeJS.ProcessEnv
  maxBuffer: number
  stdio?: ['ignore', 'pipe', 'pipe']
}

/** What the spawner reports once the child settles (mirrors execFile's callback). */
export interface GitExecOutcome {
  err: (Error & { stdout?: string; stderr?: string; code?: number | string }) | null
  stdout: string
  stderr: string
}

/** The minimal child handle the timeout layer needs: something it can kill (and, for stdin, end). */
interface GitChild {
  kill(signal?: NodeJS.Signals | number): boolean
  stdin?: { end(data: string): void } | null
}

/**
 * Seam that actually launches git. Returns the child (so the timeout layer can
 * kill it) plus a promise that settles when it exits. Injectable so tests can
 * simulate a hang without a real long-running process.
 */
export type GitSpawn = (
  args: string[],
  opts: GitExecOpts,
  input: string | undefined,
) => {
  child: GitChild
  done: Promise<GitExecOutcome>
}

const defaultGitSpawn: GitSpawn = (args, opts, input) => {
  let child!: GitChild
  const done = new Promise<GitExecOutcome>((resolve) => {
    const cp = execFile('git', args, opts as unknown as ExecFileOptions, (err, stdout, stderr) => {
      resolve({
        err: (err as GitExecOutcome['err']) ?? null,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      })
    })
    child = cp
    if (input !== undefined) cp.stdin?.end(input)
  })
  return { child, done }
}

let activeGitSpawn: GitSpawn = defaultGitSpawn

/** Test seam: override the git spawner (e.g. to simulate a hang). Pass `null` to restore the real one. */
export function __setGitSpawnForTest(spawn: GitSpawn | null): void {
  activeGitSpawn = spawn ?? defaultGitSpawn
}

/** Kill expired/cancelled reads, then await exit so the child is reaped before returning. */
async function runGitCore(
  args: string[],
  opts: GitExecOpts,
  input: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GitResult> {
  if (signal?.aborted) return { ok: false, stdout: '', stderr: 'git cancelled', code: 130 }
  const { child, done } = activeGitSpawn(args, opts, input)
  let timedOut = false
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => {
    if (settled) return
    try {
      child.kill('SIGKILL')
    } catch {
      /* already exited */
    }
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      // SIGKILL, not SIGTERM: the point is to free a WEDGED git; a gentler signal
      // it may be ignoring is what got us here.
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    timer.unref?.()
  }

  const outcome = await done
  settled = true
  signal?.removeEventListener('abort', abort)
  if (timer) clearTimeout(timer)
  if (signal?.aborted) return { ok: false, stdout: '', stderr: 'git cancelled', code: 130 }

  if (timedOut) {
    return {
      ok: false,
      timedOut: true,
      stdout: outcome.stdout || outcome.err?.stdout || '',
      stderr: `git ${args[0] ?? ''} timed out after ${timeoutMs}ms`,
      code: 124,
    }
  }

  const err = outcome.err
  if (err) {
    return {
      ok: false,
      stdout: err.stdout ?? outcome.stdout ?? '',
      stderr: err.stderr ?? outcome.stderr ?? err.message ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
      ...(err.code === MAX_BUFFER_CODE ? { truncated: true } : {}),
    }
  }
  return { ok: true, stdout: outcome.stdout, stderr: outcome.stderr, code: 0 }
}

export async function runGit(
  cwd: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
  timeoutMs?: number,
  maxBufferBytes?: number,
  signal?: AbortSignal,
): Promise<GitResult> {
  // Close stdin so a hook or credential helper that tries to read /dev/tty fails
  // fast instead of blocking forever; stdout/stderr stay piped so execFile still
  // captures output (verified under Bun + Node).
  const opts: GitExecOpts = {
    cwd,
    // A read that samples its output may set a tighter ceiling, so execFile stops before
    // buffering megabytes the caller would discard. An invalid value falls back to the
    // shared default rather than disabling the guard.
    maxBuffer:
      maxBufferBytes !== undefined && Number.isFinite(maxBufferBytes) && maxBufferBytes >= 1_024
        ? Math.floor(maxBufferBytes)
        : GIT_MAX_BUFFER,
    env: gitHardenedEnv(extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  return runGitCore(args, opts, undefined, resolveGitTimeoutMs(args, timeoutMs), signal)
}

/**
 * Run git with a patch (or other text) fed on stdin — the one case `runGit` can't
 * cover, since it closes stdin so hooks/credential helpers fail fast. Used by
 * line-level staging to pipe a built patch into `git apply`. Same hardened env +
 * wall-clock timeout; never rejects (mirrors `runGit`'s ok:false contract).
 */
export async function runGitWithInput(
  cwd: string,
  args: string[],
  input: string,
  timeoutMs?: number,
): Promise<GitResult> {
  const opts: GitExecOpts = { cwd, maxBuffer: GIT_MAX_BUFFER, env: gitHardenedEnv() }
  return runGitCore(args, opts, input, resolveGitTimeoutMs(args, timeoutMs))
}

/**
 * A git runner bound to one working directory — what the op modules consume.
 * `extraEnv` layers onto the hardened base env (used to hand git a
 * non-interactive sequence/message editor for a scripted rebase); `timeoutMs`
 * optionally overrides the per-op default. All existing callers pass just `args`.
 */
export type GitRunner = (
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
  timeoutMs?: number,
  /** Optional per-invocation stdout/stderr capture ceiling; defaults to 8 MB. */
  maxBufferBytes?: number,
) => Promise<GitResult>

export function gitRunner(cwd: string, signal?: AbortSignal): GitRunner {
  return (args, extraEnv, timeoutMs, maxBufferBytes) =>
    runGit(cwd, args, extraEnv, timeoutMs, maxBufferBytes, signal)
}

/** True when `cwd` is inside a git working tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  return res.ok && res.stdout.trim() === 'true'
}

/** First non-empty line of a (possibly multi-line) git error message. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  )
}
