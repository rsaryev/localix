/**
 * Collect a `Bun.spawn` child's output — waiting for the PROCESS, never for a pipe someone else
 * holds, and never longer than the caller allows.
 *
 * This lived in the DevOps mini app, and the mini app template — the starting point of every mini
 * app a person builds — shipped its own version of the wait with exactly the defect this one
 * closes: `await Promise.all([pipe text, pipe text, proc.exited])`, plus a SIGTERM the child may
 * ignore. One owner here, beside `awaitBunChildGone`, so a copied mini app starts from the safe
 * shape.
 *
 * Release It!: put an explicit, intentional limit on a wait you do not control.
 */
import { EXIT_DRAIN_MS } from './child-exit'

/** The piped shape of a `Bun.spawn`. Structural, so a test can drive a real child. */
export interface PipedProcess {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

export interface KillablePipedProcess extends PipedProcess {
  kill(signal?: number | NodeJS.Signals): void
}

export interface ProcessOutput {
  stdout: string
  stderr: string
  exitCode: number
  /** True when we stopped on the child's exit + drain rather than on pipe EOF — i.e.
   *  something the command left behind still holds our stdio. Diagnostic only. */
  viaExit: boolean
}

/** Read one pipe, keeping what arrives until we let go — then draining to nowhere. */
function collect(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = []
  let capture = true
  const reader = stream.getReader()
  const done = (async () => {
    for (;;) {
      const r = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (r.done) break
      // After release we keep READING and discard: a survivor must never block on a full
      // pipe buffer, and we must not cancel — closing our read end would EPIPE it.
      if (r.value && capture) chunks.push(r.value)
    }
  })()
  return {
    done,
    release: () => {
      capture = false
    },
    text: () => new TextDecoder().decode(Buffer.concat(chunks)),
  }
}

/**
 * Wait for the PROCESS, never for a pipe someone else holds.
 *
 * `await Promise.all([...pipes, proc.exited])` waits for pipe EOF, and EOF needs EVERY write end
 * closed, not just the child's. Anything the command left behind inherited them (`foo &`,
 * `setsid`, a daemon), so the wait outlives the process: measured on Bun, a child that exits in
 * 2ms but leaves a grandchild holding stdout for 3s took 3006ms; a real daemon holds them for as
 * long as it lives. `stdout.cancel()` WOULD release the fd on Bun, but it closes our read end and
 * EPIPEs the survivor — so we drain to nowhere instead.
 */
export async function readProcessOutput(proc: PipedProcess): Promise<ProcessOutput> {
  const out = collect(proc.stdout)
  const err = collect(proc.stderr)
  const exitCode = await proc.exited // the CHILD is gone — nothing more of ITS output is coming
  const pipesClosed = Promise.all([out.done, err.done]).then(() => true)
  const viaExit = !(await Promise.race([pipesClosed, Bun.sleep(EXIT_DRAIN_MS).then(() => false)]))
  out.release()
  err.release()
  return { stdout: out.text(), stderr: err.text(), exitCode, viaExit }
}

/**
 * {@link readProcessOutput}, bounded: a child that itself never exits (a CLI blocked on a stale
 * socket that accepts and never answers) is SIGKILLed at `timeoutMs` and the call rejects with
 * `"<label> timed out after <n>ms"`. SIGKILL is deliberate — this is for short-lived CLI clients,
 * whose polite-exit path is exactly what is wedged. `label` defaults to `Command`.
 */
export async function readProcessOutputWithTimeout(
  proc: KillablePipedProcess,
  timeoutMs: number,
  opts: { label?: string } = {},
): Promise<ProcessOutput> {
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill('SIGKILL')
  }, timeoutMs)
  try {
    const output = await readProcessOutput(proc)
    if (timedOut) throw new Error(`${opts.label ?? 'Command'} timed out after ${timeoutMs}ms`)
    return output
  } finally {
    clearTimeout(timer)
  }
}
