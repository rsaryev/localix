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

/**
 * THE HOST SIDE of one mod instance's VM: a QuickJS VM of its own, in a worker thread, running the
 * mods runtime (`guest/`) and then the hooks module. The engine keeps running every chain here;
 * each hook the module registered is a stand-in that runs the module's hook in the VM, serving
 * its `$` calls and its `next` with the `$` and `next` of that run — so budgets, pauses, retries
 * and streams behave as they do for a hook in this process (`stand-in.ts`).
 *
 * The VM has no environment, file, network or process of its own; `$` is its only way out. What it
 * sends is untrusted: the hooks it registered are checked (`hook-specs.ts`), what it sends is
 * bounded (`WIRE_LIMITS`), as are its console lines, its unhandled rejections and the calls it has
 * in flight at once. The VM itself bounds its heap (`memoryLimitBytes`: an allocation past it
 * fails inside the VM) and its turns (a turn past `hangMs` is interrupted). A VM that did not
 * finish loading within `hangMs`, held its thread, or crashed is stopped, and `onDeath` tells the
 * host. The host's own thread never waits on it.
 */

/**
 * A JavaScript VM a mod instance runs in, exchanging JSON text with the host: a long-lived VM of
 * `@localixai/engine-scripts` (`createScriptVms`), which the composition root hands the host.
 */
export interface ModVmPort {
  start(input: {
    runtime: string
    name: string
    sliceMs: number
    memoryLimitBytes?: number
    onMessage(json: string): void
    onUnhandledRejection?(message: string): void
    onExit(reason: string): void
  }): { send(json: string): void; stop(): void }
}

export interface ModVmOptions {
  vms: ModVmPort
  /** The mods runtime the VM runs first (`guest-file.ts`). */
  runtime: string
  /** The bundled hooks module, sent to the VM as text (`module-build.ts`). */
  code: string
  /** What the module's stack traces name it. */
  name: string
  /** An unsettled `register`, or a turn that holds the VM's thread, for this long: the VM goes. */
  hangMs: number
  /** The VM's heap. */
  memoryLimitBytes: number
  /** The clock a load's budget runs on; tests drive their own. */
  clock: BudgetClock
  /** The instance's `$` for a call a closure makes after its hook ended. */
  apiOf: () => ModsApi | undefined
  /** What the VM reports and survives: a rejection nothing handled. */
  report: (message: string) => void
  /** Where the module's `console` lines go, cut and bounded. */
  print?: (level: 'log' | 'error', line: string) => void
  /** The VM held its thread or crashed, and is stopped. */
  onDeath: (reason: string) => void
}

export interface ModVm {
  register: RegisterFunction
  /** The element tables `$.ui.resolve` answers in the VM, by component. */
  setTables(tables: ReadonlyMap<string, unknown>): void
  alive(): boolean
  /** Stops the VM; nothing is reported. */
  stop(): void
}

/**
 * What one value from a VM may hold. The nesting is plain data's; the count is ten times plain
 * data's, since a whole conversation's messages cross it (`session.compact`).
 */
export const WIRE_LIMITS = { depth: PLAIN_DATA_LIMITS.depth, values: 10 * PLAIN_DATA_LIMITS.values }
/** `$` calls, `next`s and invocations one VM may have waiting on the host at once. */
export const MAX_PENDING = 1_024
/** A VM's reports: at most so many a minute, each cut to so many characters. */
const REPORTS = { max: 20, windowMs: 60_000, chars: 1_000 }
/** The module's console: at most so many lines in a window, each cut to so many characters. */
const LINES = { max: 200, windowMs: 10_000, chars: 4_000 }

type Fn = (...args: unknown[]) => unknown

const printToConsole = (level: 'log' | 'error', line: string) =>
  level === 'error' ? console.error(line) : console.log(line)

export function startModVm(options: ModVmOptions): ModVm {
  const { clock } = options
  let dead = false
  let pending = 0
  const reports = createRateLimit({ max: REPORTS.max, windowMs: REPORTS.windowMs, now: clock.now })
  const lines = createRateLimit({ max: LINES.max, windowMs: LINES.windowMs, now: clock.now })
  const print = options.print ?? printToConsole

  const report = (message: string) => {
    const verdict = reports.take()
    if (verdict === 'pass') options.report(truncated(message, REPORTS.chars))
    else if (verdict === 'first-drop')
      options.report(`more than ${REPORTS.max} reports in a minute; the rest are dropped`)
  }

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
    post: (message) => vm.send(JSON.stringify(message)),
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
          // The trace of what ran beneath goes back with the answer (`next.trace`).
          if (!isHookBody(answer))
            return Promise.resolve(answer).then((value) => ({ value, trace: own.next.trace }))
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
      console: (({ level, line }: { level: unknown; line: unknown }) => {
        const verdict = lines.take()
        if (verdict === 'pass')
          print(level === 'error' ? 'error' : 'log', truncated(String(line), LINES.chars))
        else if (verdict === 'first-drop')
          print('error', `[mod] console: more than ${LINES.max} lines; some dropped`)
      }) as Handler,
    },
    builtIns: { invoke: bounded },
  })
  const calls = createCalls(endpoint)

  const streamOf = (call: number, id: number) => {
    const stream = calls.get(call)?.streams.get(id)
    if (!stream) throw new Error('the stream beneath ended with its hook')
    return stream
  }

  const vm = options.vms.start({
    runtime: options.runtime,
    name: 'mods-runtime.js',
    sliceMs: options.hangMs,
    memoryLimitBytes: options.memoryLimitBytes,
    onMessage(json) {
      let frame: unknown
      try {
        frame = JSON.parse(json)
      } catch {
        return die('sent a frame that is not JSON')
      }
      endpoint.receive(frame)
    },
    onUnhandledRejection: (message) => report(`unhandled rejection: ${message}`),
    onExit: (reason) => die(reason),
  })

  function finish(error: Error) {
    dead = true
    endpoint.close(error)
    calls.clear()
    vm.stop()
  }

  function die(reason: string) {
    if (dead) return
    finish(new Error(`the hooks module ${reason}`))
    options.onDeath(reason)
  }

  return {
    async register(on, registerOptions) {
      // Loading is a hook's work too: past the budget, the VM goes and the load fails.
      const cancel = clock.setTimer(
        () => die(`did not finish loading within ${options.hangMs} ms`),
        options.hangMs,
      )
      try {
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
  }
}

/** `owner[key]` when `key` is `owner`'s own member, as `shapeOf` sent it. */
function ownMember(owner: object, key: unknown): Record<string, unknown> | undefined {
  return typeof key === 'string' && Object.hasOwn(owner, key)
    ? (owner as Record<string, Record<string, unknown>>)[key]
    : undefined
}
