/**
 * The SOURCE port — where a `watch` monitor's events come from, and the process layer a polled
 * check runs on.
 *
 * One live source exists today (`command.ts` streams a long-lived process's lines) and a
 * WebSocket one is the obvious second. A polled `until` wait has no source: its cadence is the
 * trigger's (`triggers/kinds/poll`) and each poll is one `CheckRun`. The service starts a source,
 * receives event texts, and awaits an exit — that is the whole contract, which is why adding a
 * source means adding a file to this folder rather than editing the service.
 *
 * `exited` is a promise, not a callback, because every source has exactly one terminal
 * outcome and the service needs to await it alongside its own timeout race.
 */
import type { MonitorEndReason } from '../contracts'

/** How a source finished on its own. `killed`/`timeout`/`rate-limited` are the service's verdicts, not a source's. */
export interface MonitorSourceExit {
  reason: Extract<MonitorEndReason, 'exited' | 'condition-met' | 'error'>
  /** Model-facing evidence: the predicate that held, the exit code, the spawn failure. */
  detail?: string
}

export interface MonitorSource {
  /** Register the sink for event texts. Called once, before anything is spawned. */
  onEvent(listener: (text: string) => void): void
  /** Start producing. Separate from construction so the sink is never missed. */
  start(): void
  /** Stop producing and release the process/timer. Idempotent. */
  close(): void
  /** Resolves once — the source ended by itself. */
  exited: Promise<MonitorSourceExit>
}

/**
 * A long-lived background process, narrowed to what a source needs (see `native.ts`).
 *
 * `env` carries resolved vault values (see `../secrets.ts`) and is the ONLY channel a secret
 * travels on: it is merged into the child's environment and never appears in `command`, which
 * is what the strip, the card, the gate and the model see.
 */
export interface BackgroundSpawn {
  (input: { command: string; cwd: string; pathPrefix?: string[]; env?: Record<string, string> }): {
    onOutput(listener: (chunk: string) => void): void
    kill(): void
    exited: Promise<number | null>
  }
}

/** One bounded run of a check command. */
export interface CheckRun {
  (input: {
    command: string
    cwd: string
    timeoutMs: number
    pathPrefix?: string[]
    env?: Record<string, string>
  }): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>
}
