/**
 * Low-level `gh` (GitHub CLI) process layer. Mirrors git/cli.ts: argv arrays
 * only (NEVER string interpolation), a hardened non-interactive env, and a
 * never-reject contract — a non-zero exit resolves with ok:false so callers
 * decide what a failure means. `gh` owns auth entirely; we never touch tokens.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { toolEnv } from '@localixai/mini-app-sdk/backend'

const execFilePromise = promisify(execFile)

/** Cap on a single gh invocation's output (a large PR list with check rollups). */
const GH_MAX_BUFFER = 8_000_000

/**
 * Read process.env at CALL time (not module load) so a GUI (Finder/Dock) launch
 * that had its PATH repaired by bootstrap's ensureLoginShellEnv() still finds the
 * `gh` binary. GH_PROMPT_DISABLED + GH_NO_UPDATE_NOTIFIER keep gh from ever
 * blocking on a prompt or emitting update chatter into our captured stdout.
 */
function ghHardenedEnv(): NodeJS.ProcessEnv {
  return {
    // Plus the install dirs a GUI app's PATH misses — Homebrew's `gh` lives in one.
    ...toolEnv(),
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

export interface GhResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number
  /** True when the `gh` binary itself is missing from PATH (spawn ENOENT). */
  notFound: boolean
}

/** Default wall-clock cap for a gh call (a stalled proxy/DNS/outage must fail, not hang). */
const GH_DEFAULT_TIMEOUT_MS = 10_000

export async function runGh(
  cwd: string,
  args: string[],
  timeoutMs = GH_DEFAULT_TIMEOUT_MS,
): Promise<GhResult> {
  try {
    // Every gh call is a network round-trip — a stalled proxy/DNS/outage must
    // fail the call, not hang the route. Default 10s wall-clock, hard kill; a
    // slow call (e.g. a large PR diff) can pass a longer cap.
    const opts = {
      cwd,
      maxBuffer: GH_MAX_BUFFER,
      env: ghHardenedEnv(),
      timeout: timeoutMs,
      killSignal: 'SIGKILL' as const,
    }
    // Close stdin so gh can never block reading a prompt; keep stdout/stderr piped.
    ;(opts as { stdio?: ['ignore', 'pipe', 'pipe'] }).stdio = ['ignore', 'pipe', 'pipe']
    const { stdout, stderr } = await execFilePromise('gh', args, opts)
    return { ok: true, stdout, stderr, code: 0, notFound: false }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string }
    const notFound = e.code === 'ENOENT'
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
      notFound,
    }
  }
}
