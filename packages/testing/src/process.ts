// Child processes in tests always have a deadline and are killed with SIGKILL when they miss it:
// a hung child is invisible to the per-test timeout and would hold the whole run open.
import { spawn, spawnSync } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  /** Wall-clock budget; the child is SIGKILLed when it runs out. Default 10 s. */
  timeoutMs?: number
  /** Written to the child's stdin, which is then closed. */
  input?: string
}

export interface RunResult {
  /** Exit code, or null when the child was killed. */
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Run a command to completion, synchronously. Never throws for a non-zero exit. */
export function runSync(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT')
    throw result.error
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
  }
}

/** Run a command to completion without blocking the event loop. Never rejects for a non-zero exit. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.end(options.input ?? '')
  })
}
