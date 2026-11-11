import { AsyncLocalStorage } from 'node:async_hooks'
import {
  describeApi,
  type ApiShape,
  type CallMeta,
  type CallReply,
  type Endpoint,
} from '../../plugins/kit'

/**
 * The host's side of each call into a mod's VM: the stand-in the engine runs for a hook the
 * module registered, and the calls it opened. What the VM asks names its call, and runs in the
 * async context that call was made in (the conversation's scene, a pane's drawing) — the call's
 * own, never one the VM names — so a VM cannot run a `$` call in another call's scene.
 * A call the engine abandoned (`next.signal`) stops waiting on the VM at once.
 */

type Run = <T>(work: () => T) => T

/** A hook's `$` as the host lends it: namespaces of methods and values. */
export type DollarApi = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** The `next` a hook run gets from the chain, as far as a VM's call mirrors it. */
export interface HookNext {
  (e: unknown): unknown
  to(e: unknown, tier: never): unknown
  readonly signal: AbortSignal
  readonly origin: unknown
  readonly event: string
  readonly budget: { readonly ms: number; readonly remainingMs: number }
  readonly trace: unknown
  readonly error?: unknown
  readonly called?: boolean
}

/** A hook as the chain runs it: the module's hook, run in the VM. */
export type StandIn = (
  $: DollarApi,
  e: unknown,
  next: HookNext,
) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>

export interface OpenCall {
  api: DollarApi
  next: HookNext
  streams: Map<number, AsyncGenerator<unknown, unknown, unknown> & { result?: unknown }>
}

/** Contexts kept for what a VM asks after its call answered (a stashed `$`), beyond open calls. */
const CONTEXTS_KEPT = 512

export function createCalls(endpoint: Endpoint) {
  let lastCall = 0
  const open = new Map<number, OpenCall>()
  const contexts = new Map<number, Run>()

  /** Drop the oldest context whose call answered; an open call's stays while it runs. */
  function forgetOldestClosed() {
    for (const call of contexts.keys()) {
      if (open.has(call)) continue
      contexts.delete(call)
      return
    }
  }

  function begin(hook: number, $: DollarApi, e: unknown, next: HookNext) {
    const call = ++lastCall
    open.set(call, { api: $, next, streams: new Map() })
    contexts.set(call, AsyncLocalStorage.snapshot() as Run)
    if (contexts.size > CONTEXTS_KEPT) forgetOldestClosed()
    const abort = () => endpoint.notify('abort', { call })
    next.signal.addEventListener('abort', abort, { once: true })
    const meta: CallMeta = {
      origin: next.origin,
      event: next.event,
      budget: { ms: next.budget.ms, remainingMs: next.budget.remainingMs },
      ...(next.error ? { error: next.error, called: next.called } : {}),
    }
    return {
      payload: { hook, call, e, shape: shapeOf($), next: meta },
      signal: next.signal,
      close: () => {
        open.delete(call)
        next.signal.removeEventListener('abort', abort)
      },
    }
  }

  /** A stand-in for the module's hook `spec`: one run of it in the VM per call. */
  function standIn(spec: { id: number; generator: boolean }): StandIn {
    const start = ($: DollarApi, e: unknown, next: HookNext) => begin(spec.id, $, e, next)
    if (spec.generator)
      return async function* ($: DollarApi, e: unknown, next: HookNext) {
        const { payload, close, signal } = start($, e, next)
        let id: number | undefined
        try {
          const reply = (await endpoint.request('call', payload, signal)) as CallReply
          // Its matcher missed in the VM: the hook passes the event on, as if it had not matched.
          if ('absent' in reply) return yield* next(e) as AsyncGenerator<unknown, unknown, unknown>
          id = (reply as { stream: number }).stream
          for (;;) {
            const step = (await endpoint.request('step', { id }, signal)) as {
              done: boolean
              value: unknown
            }
            if (step.done) {
              id = undefined
              return step.value
            }
            yield step.value
          }
        } finally {
          if (id !== undefined) endpoint.notify('end', { id })
          close()
        }
      }
    return async ($, e, next) => {
      const { payload, close, signal } = start($, e, next)
      try {
        const reply = (await endpoint.request('call', payload, signal)) as CallReply
        return 'absent' in reply ? next(e) : (reply as { value: unknown }).value
      } finally {
        close()
      }
    }
  }

  return {
    standIn,
    /** The open call `call`, while its hook runs. */
    get: (call: unknown) => (typeof call === 'number' ? open.get(call) : undefined),
    /** Runs `work` in the context call `call` was made in, or in none for a call long gone. */
    within<T>(call: unknown, work: () => T): T {
      const run = typeof call === 'number' ? contexts.get(call) : undefined
      return run ? run(work) : work()
    },
    clear() {
      open.clear()
      contexts.clear()
    },
  }
}

/** `$` as the VM rebuilds it: how each method answers (`describeApi`), and the values of the rest. */
function shapeOf(api: DollarApi): ApiShape {
  const shape: ApiShape = {}
  for (const { name: namespace, members } of describeApi(api as never)) {
    const own: ApiShape[string] = {}
    for (const { name, kind, ownTime } of members)
      own[name] =
        kind === 'value'
          ? { value: api[namespace]![name] }
          : { fn: kind, ...(ownTime ? { ownTime } : {}) }
    shape[namespace] = own
  }
  return shape
}
