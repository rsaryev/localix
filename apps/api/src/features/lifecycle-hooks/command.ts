import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EXIT_DRAIN_MS, awaitChildGone, releaseChildPipes } from '../../lib/child-exit'
import { killProcessTreeNow } from '../../lib/process-tree'
import { withTimeout } from '../../lib/timeout'
import { createStreamTextDecoder } from '../../lib/stream-text'
import { resolveHookSpawnTarget, type HookShell, type HookSpawnTarget } from './command-target'

export interface HookCommandOptions {
  command: string
  /** Exec form: spawn `command` directly with these arguments, no shell (`command-target.ts`). */
  args?: readonly string[]
  /** Shell form only: `powershell` runs `command` through PowerShell instead of bash. */
  shell?: HookShell
  /** Shell form: rewrite `command` for PowerShell when PowerShell runs it (`command-target.ts`). */
  forPowerShell?: (command: string) => string
  input: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export interface HookCommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

/**
 * Protocol-independent command transport. The caller supplies bytes and environment and owns
 * the interpretation of exit codes. A descendant holding a pipe cannot extend the host's wait.
 */
export function runHookCommand(options: HookCommandOptions): Promise<HookCommandResult> {
  if (
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 0
  ) {
    throw new Error('Hook command limits must be finite and non-negative, with a positive timeout')
  }
  if (options.signal?.aborted)
    return Promise.resolve({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: true,
    })
  // Shell form runs through the resolved agent shell, not a literal `sh`: Windows has no `sh` on
  // PATH, so every hook failed to spawn there while the agent's own commands ran through Git Bash.
  // Exec form spawns the executable itself. A target that cannot be resolved or spawned becomes
  // the hook's stderr, the same non-throwing shape any other failed hook produces.
  const failed = (error: unknown): Promise<HookCommandResult> =>
    Promise.resolve({
      code: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
      aborted: false,
    })
  let target: HookSpawnTarget
  try {
    target = resolveHookSpawnTarget(options)
  } catch (error) {
    return failed(error)
  }
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(target.file, target.argv, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      // A group leader, so a timeout or abort reaches what a shell hook started (a pipeline,
      // `cmd; other`), not only the shell.
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    return failed(error)
  }
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let aborted = false
    let settled = false
    const killTree = () => killProcessTreeNow(child.pid)
    const abort = () => {
      aborted = true
      killTree()
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, options.timeoutMs)
    timer.unref?.()
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      releaseChildPipes(child)
      resolve({ code, stdout, stderr, timedOut, aborted })
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()

    const decodeOut = createStreamTextDecoder()
    const decodeErr = createStreamTextDecoder()
    child.stdout.on('data', (data: Buffer) => {
      const captured = data.subarray(0, Math.max(0, options.maxOutputBytes - stdoutBytes))
      stdoutBytes += captured.length
      stdout += decodeOut(captured)
    })
    child.stderr.on('data', (data: Buffer) => {
      const captured = data.subarray(0, Math.max(0, options.maxOutputBytes - stderrBytes))
      stderrBytes += captured.length
      stderr += decodeErr(captured)
    })
    // Bound the wait independently of pipe lifetime; preserve the output-drain grace for
    // normal exits and stop the timeout once the process has actually exited.
    void withTimeout(
      awaitChildGone(child, { onExit: () => clearTimeout(timer) }),
      options.timeoutMs + 1_000 + EXIT_DRAIN_MS,
      'hook',
    ).then(
      ({ code, error }) => {
        // A missing executable (exec form) reports only through the spawn error.
        if (error && !stderr) stderr = error.message
        finish(code)
      },
      () => {
        timedOut = true
        killTree()
        finish(null)
      },
    )
    child.stdin.on('error', () => {})
    child.stdin.end(options.input)
  })
}
