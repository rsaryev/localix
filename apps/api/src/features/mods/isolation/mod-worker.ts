import {
  PLAIN_DATA_LIMITS,
  isHookBody,
  type BudgetClock,
  type ModsApi,
  type RegisterFunction,
} from '@localixai/claude-plugin/mods'
import { createEndpoint, type Handler } from './endpoint'
import { readHookSpecs } from './hook-specs'
import { createRateLimit, truncated } from './rate-limit'
import { createCalls } from './stand-in'
import { startWatchdog, SUPERVISOR_CLOCK, type Watchdog } from './watchdog'

/**
 * THE HOST SIDE of one mod instance's worker (`worker-main.ts`). The engine keeps running every
 * chain here; each hook the module registered is a stand-in that runs the module's hook in the
 * worker, serving its `$` calls and its `next` with the `$` and `next` of that run — so budgets,
 * pauses, retries and streams behave as they do for a hook in this process (`stand-in.ts`).
 *
 * The worker starts with no environment (`Bun.env` is empty there). Whatever it sends is
 * untrusted: the hooks it registered are checked (`hook-specs.ts`), what it sends is bounded
 * (`WIRE_LIMITS`), as are its reports and the calls it has in flight at once. A worker that does
 * not finish loading within `hangMs`, holds its thread (`watchdog.ts`), crashes or
 * exits is terminated, and `onDeath` tells the host. The host's own thread never waits on it.
 */

export interface ModWorkerOptions {
  /** The bundled hooks module, sent to the worker as text (`module-build.ts`). */
  code: string
  /** What the module's stack traces name it. */
  name: string
  workerUrl: string | URL
  /** No answer to a ping, or an unsettled `register`, for this long: the worker is stopped. */
  hangMs: number
  /** The clock the worker is watched on; tests drive their own. */
  clock?: BudgetClock
  /** The instance's `$` for a call a closure makes after its hook ended. */
  apiOf: () => ModsApi | undefined
  /** What the worker reports and survives: a rejection nothing handled. */
  report: (message: string) => void
  /** The worker hung, crashed or exited by itself, and is terminated. */
  onDeath: (reason: string) => void
}

export interface ModWorker {
  register: RegisterFunction
  /** The element tables `$.ui.resolve` answers in the worker, by component. */
  setTables(tables: ReadonlyMap<string, unknown>): void
  alive(): boolean
  /** Terminates the worker; nothing is reported. */
  stop(): void
  /** Terminates the worker and reports it dead, with `reason`. */
  kill(reason: string): void
}

/**
 * What one value from a worker may hold. The nesting is plain data's; the count is ten times
 * plain data's, since a whole conversation's messages cross it (`session.compact`).
 */
export const WIRE_LIMITS = { depth: PLAIN_DATA_LIMITS.depth, values: 10 * PLAIN_DATA_LIMITS.values }
/** `$` calls, `next`s and invocations one worker may have waiting on the host at once. */
export const MAX_PENDING = 1_024
/** A worker's reports: at most so many a minute, each cut to so many characters. */
const REPORTS = { max: 20, windowMs: 60_000, chars: 1_000 }

type Fn = (...args: unknown[]) => unknown

export function startModWorker(options: ModWorkerOptions): ModWorker {
  const clock = options.clock ?? SUPERVISOR_CLOCK
  const worker = new Worker(options.workerUrl, { env: {}, smol: true } as WorkerOptions)
  let dead = false
  let pending = 0
  let watchdog: Watchdog | undefined
  let markReady!: () => void
  const ready = new Promise<void>((resolve) => (markReady = resolve))
  const reports = createRateLimit({ max: REPORTS.max, windowMs: REPORTS.windowMs, now: clock.now })

  /** A handler that counts while it waits, refusing past `MAX_PENDING`. */
  const bounded =
    (handler: (payload: never) => unknown): Handler =>
    (payload) => {
      if (pending >= MAX_PENDING)
        throw new Error(`the hooks module has over ${MAX_PENDING} calls waiting at once`)
      pending += 1
      const settle = () => void (pending -= 1)
      try {
        const answer = handler(payload)
        Promise.resolve(answer).then(settle, settle)
        return answer
      } catch (error) {
        settle()
        throw error
      }
    }

  const endpoint = createEndpoint({
    post: (message) => worker.postMessage(message),
    limits: WIRE_LIMITS,
    malformed: (reason) => die(`sent ${reason}`),
    handlers: {
      api: bounded(({ call, path, args }: { call: number; path: unknown; args: unknown }) =>
        calls.within(call, () => {
          const api = calls.get(call)?.api ?? options.apiOf()
          const [namespace, name] = Array.isArray(path) ? path : []
          // Only `$`'s own members: never `constructor`, `__defineGetter__` or another inherited.
          const members = api && ownMember(api, namespace)
          const member = members && ownMember(members, name)
          if (typeof member !== 'function')
            throw new Error(`$.${String(namespace)}.${String(name)} is not a function`)
          if (!Array.isArray(args))
            throw new Error(`$.${String(namespace)}.${String(name)} was called without arguments`)
          return (member as Fn).apply(members, args)
        }),
      ),
      next: bounded(({ call, e, tier }: { call: number; e: unknown; tier?: string }) =>
        calls.within(call, () => {
          const own = calls.get(call)
          if (!own) throw new Error('next called after its hook ended')
          const answer = tier === undefined ? own.next(e) : own.next.to(e, tier as never)
          if (!isHookBody(answer)) return Promise.resolve(answer).then((value) => ({ value }))
          const id = own.streams.size + 1
          own.streams.set(id, answer)
          return { stream: id }
        }),
      ),
      'stream.next': bounded(({ call, id }: { call: number; id: number }) =>
        calls.within(call, () => streamOf(call, id).next()),
      ),
      'stream.result': bounded(({ call, id }: { call: number; id: number }) =>
        calls.within(call, () => streamOf(call, id).result),
      ),
      report: (({ message }: { message: unknown }) => {
        const verdict = reports.take()
        if (verdict === 'pass') options.report(truncated(String(message), REPORTS.chars))
        else if (verdict === 'first-drop')
          options.report(`more than ${REPORTS.max} reports in a minute; the rest are dropped`)
      }) as Handler,
      crash: (({ message }: { message: unknown }) =>
        die(`crashed: ${truncated(String(message), REPORTS.chars)}`)) as Handler,
    },
    builtIns: { invoke: bounded },
  })
  const calls = createCalls(endpoint)

  const streamOf = (call: number, id: number) => {
    const stream = calls.get(call)?.streams.get(id)
    if (!stream) throw new Error('the stream beneath ended with its hook')
    return stream
  }

  worker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { t?: unknown } | null
    if (message?.t === 'pong') watchdog?.pong()
    else if (message?.t === 'ready') {
      // A worker still starting is not looked at: it answers nothing until its module ran.
      watchdog ??= startWatchdog({
        clock,
        hangMs: options.hangMs,
        ping: () => worker.postMessage({ t: 'ping' }),
        die,
      })
      markReady()
    } else endpoint.receive(message)
  })
  worker.addEventListener('error', (event: ErrorEvent) => {
    event.preventDefault()
    die(`crashed: ${truncated(crashMessage(event.message), REPORTS.chars)}`)
  })
  worker.addEventListener('close', () => die('exited'))

  function finish(error: Error) {
    dead = true
    watchdog?.stop()
    endpoint.close(error)
    calls.clear()
    try {
      void worker.terminate()
    } catch {
      // Gone already.
    }
  }

  function die(reason: string) {
    if (dead) return
    finish(new Error(`the hooks module ${reason}`))
    options.onDeath(reason)
  }

  return {
    async register(on, registerOptions) {
      // Loading is a hook's work too: past the budget, the worker goes and the load fails.
      const cancel = clock.setTimer(
        () => die(`did not finish loading within ${options.hangMs} ms`),
        options.hangMs,
      )
      try {
        await Promise.race([
          ready,
          new Promise((resolve) => worker.addEventListener('close', resolve)),
        ])
        const answer = await endpoint.request('load', {
          code: options.code,
          name: options.name,
          options: registerOptions,
        })
        for (const spec of readHookSpecs(answer)) {
          const hook = calls.standIn(spec)
          const registration =
            spec.matcher === undefined ? on(spec.event, hook) : on(spec.event, spec.matcher, hook)
          if (spec.onError) registration.catch(calls.standIn(spec.onError))
        }
      } finally {
        cancel()
      }
    },
    setTables(tables) {
      endpoint.notify('tables', { tables: Object.fromEntries(tables) })
    },
    alive: () => !dead,
    stop() {
      if (!dead) finish(new Error('the hooks module was stopped'))
    },
    kill: die,
  }
}

/** `owner[key]` when `key` is `owner`'s own member, as `shapeOf` sent it. */
function ownMember(owner: object, key: unknown): Record<string, unknown> | undefined {
  return typeof key === 'string' && Object.hasOwn(owner, key)
    ? (owner as Record<string, Record<string, unknown>>)[key]
    : undefined
}

/**
 * The error of a worker's `error` event: Bun prints the source around the throw first, then
 * `error: <message>`, then the stack; the message alone is what a person needs.
 */
function crashMessage(printed: string): string {
  const line = printed
    .split('\n')
    .reverse()
    .find((one) => one.startsWith('error: '))
  return line ? line.slice('error: '.length) : (printed.split('\n')[0] ?? printed)
}
