import { childEnv } from '../../../lib/login-shell-env'
import { modFetch, type HttpInit } from './http-api'

/**
 * `$.http`, `$.process`, `$.env` and `$.clock`, with Claude Code's limits: a fetch is bounded in
 * `http-api.ts`; a process runs 30 s by default and 10 min at most, with no shell. `$.env.set`
 * changes only what this mod's own processes see. `$.clock.after` and `every` answer a timer whose
 * `cancel()` stops it; a timer's callback that throws is reported, never left unhandled. A mod's
 * timers stop when the mod unloads (`dispose`). `every` fires at most every `MIN_EVERY_MS`, and an
 * instance has at most `MAX_TIMERS` timers and sleeps pending at once: each firing crosses into
 * the mod's VM, so a timer every millisecond would flood Localix's own thread.
 */
const PROCESS_MS = 30_000
const PROCESS_MAX_MS = 10 * 60_000
export const MIN_EVERY_MS = 100
export const MAX_TIMERS = 100

export interface ProcessInit {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
}

/** Starts `fire` after `ms`, once or every `ms`, and answers how to stop it. */
export type Schedule = (fire: () => void, ms: number, repeat: boolean) => () => void

const realSchedule: Schedule = (fire, ms, repeat) => {
  if (repeat) {
    const handle = setInterval(fire, ms)
    return () => clearInterval(handle)
  }
  const handle = setTimeout(fire, ms)
  return () => clearTimeout(handle)
}

/** A pending timer from `$.clock.after` / `$.clock.every`, as Claude Code answers it. */
export interface ModTimer {
  cancel: () => void
}

/** What one stream of a child may hand back: 4 MiB, as Claude Code's `$.process.run` holds it. */
const OUTPUT_BYTES = 4 * 1024 * 1024

/** A child's stream as text, its first 4 MiB, and whether more was read and dropped. */
async function capped(stream: ReadableStream<Uint8Array>) {
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  const isTruncated = bytes.length > OUTPUT_BYTES
  return {
    text: new TextDecoder().decode(isTruncated ? bytes.subarray(0, OUTPUT_BYTES) : bytes),
    isTruncated,
  }
}

export function createSystemApi(input: {
  cwd: () => string
  fetcher?: typeof fetch
  /** A timer's callback threw or rejected: `call` is `clock.after` or `clock.every`. */
  onTimerError?: (call: string, error: unknown) => void
  schedule?: Schedule
}) {
  const env: Record<string, string> = {}
  const schedule = input.schedule ?? realSchedule
  const timers = new Set<() => void>()
  const later = (fire: () => void, ms: number, repeat: boolean) => {
    if (timers.size >= MAX_TIMERS)
      throw new Error(`a mod has at most ${MAX_TIMERS} timers and sleeps pending at once`)
    let stop: (() => void) | null = null
    const cancel = () => {
      stop?.()
      stop = null
      timers.delete(cancel)
    }
    stop = schedule(
      () => {
        if (!repeat) cancel()
        fire()
      },
      ms,
      repeat,
    )
    timers.add(cancel)
    return cancel
  }
  const timer = (call: string, repeat: boolean) => (ms: unknown, fire: unknown) => {
    if (typeof fire !== 'function') throw new Error(`${call} takes a function to call`)
    const wait = Math.max(repeat ? MIN_EVERY_MS : 0, typeof ms === 'number' && ms > 0 ? ms : 0)
    const report = (error: unknown) => input.onTimerError?.(call, error)
    const run = () => {
      try {
        void Promise.resolve((fire as () => unknown)()).catch(report)
      } catch (error) {
        report(error)
      }
    }
    return { cancel: later(run, wait, repeat) } satisfies ModTimer
  }
  return {
    http: {
      fetch: (target: unknown, init?: HttpInit) => {
        const call =
          typeof target === 'string'
            ? { url: target, ...init }
            : (target as HttpInit & { url: string })
        return modFetch(call.url, call, input.fetcher)
      },
    },
    process: {
      async run(argv: readonly string[], init: ProcessInit = {}) {
        if (!Array.isArray(argv) || argv.length === 0) throw new Error('run takes an argv list')
        const proc = Bun.spawn([...argv], {
          cwd: init.cwd ?? input.cwd(),
          env: childEnv({ ...env, ...init.env }) as Record<string, string | undefined>,
          windowsHide: true,
          stdin: init.stdin === undefined ? 'ignore' : new Blob([init.stdin]),
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const ms = Math.min(init.timeoutMs ?? PROCESS_MS, PROCESS_MAX_MS)
        let timer: ReturnType<typeof setTimeout> | undefined
        // Still running at its time: SIGKILLed, and the call rejects as Claude Code's does. It
        // rejects without waiting for the exit or the pipes: a descendant may hold them open.
        const expired = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            proc.kill('SIGKILL')
            reject(new Error(`process.run: ${argv[0]} was still running after ${ms} ms`))
          }, ms)
        })
        try {
          const finished = Promise.all([capped(proc.stdout), capped(proc.stderr), proc.exited])
          finished.catch(() => {})
          const [stdout, stderr, exitCode] = await Promise.race([finished, expired])
          return {
            exitCode,
            stdout: stdout.text,
            stderr: stderr.text,
            isStdoutTruncated: stdout.isTruncated,
            isStderrTruncated: stderr.isTruncated,
          }
        } finally {
          clearTimeout(timer)
        }
      },
    },
    env: {
      get: (name: unknown) => {
        const key = typeof name === 'string' ? name : (name as { name: string }).name
        return env[key] ?? process.env[key]
      },
      set: (name: unknown, value?: string) => {
        const call =
          typeof name === 'string' ? { name, value } : (name as { name: string; value?: string })
        if (call.value === undefined) delete env[call.name]
        else env[call.name] = call.value
        // Claude Code's answer when the write was made: no `deny`.
        return {}
      },
    },
    clock: {
      now: () => Date.now(),
      // The caller's signal cuts the wait short: the sleep rejects with its reason.
      sleep: (ms: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          const signal = options?.signal instanceof AbortSignal ? options.signal : undefined
          if (signal?.aborted) return reject(signal.reason)
          const cancel = later(
            resolve,
            typeof ms === 'number' ? ms : (ms as { ms: number }).ms,
            false,
          )
          signal?.addEventListener('abort', () => (cancel?.(), reject(signal.reason)), {
            once: true,
          })
        }),
      after: timer('clock.after', false),
      every: timer('clock.every', true),
    },
    dispose() {
      for (const cancel of Array.from(timers)) cancel()
    },
  }
}
