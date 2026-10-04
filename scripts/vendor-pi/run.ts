/**
 * Running a command, with a deadline, and the two ways the vendor tooling fails.
 *
 * Every child gets a timeout: this code runs inside a pre-commit hook, and a child that never exits
 * is a commit that never finishes. A timed-out child is reported as such, not as an ordinary
 * failure, because the right reaction differs — an unreachable network is moved past, a failing
 * merge is not.
 */

export interface Run {
  ok: boolean
  stdout: string
  stderr: string
  timedOut: boolean
}

export async function run(
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<Run> {
  const proc = Bun.spawn(cmd, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    // Always explicit: without `env`, Bun hands a child the environment the process STARTED with,
    // not `process.env` as it is now. The sync test isolates its scratch repositories by setting
    // `GIT_CONFIG_GLOBAL=/dev/null` in `process.env`; that never reached this child, so its merge
    // commit went through the developer's commit signing and waited on a prompt until it timed out.
    env: options.env ?? process.env,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  const timedOut = proc.signalCode === 'SIGTERM' && options.timeoutMs !== undefined
  return { ok: code === 0 && !timedOut, stdout: stdout.trim(), stderr: stderr.trim(), timedOut }
}

/** Something a person (or agent) has to decide: the merge stops and says what and where. */
export class SyncFailure extends Error {
  constructor(
    message: string,
    readonly detail: string = '',
  ) {
    super(message)
  }
}

/** Upstream could not be reached. Offline is not a failure of the fork; the caller moves past it. */
export class UpstreamUnreachable extends SyncFailure {}
