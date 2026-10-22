import { AsyncLocalStorage } from 'node:async_hooks'
import type { Hook, ModsApi, Next } from '@localixai/claude-plugin/mods'
import type { Endpoint } from './endpoint'
import type { ApiShape, CallMeta } from './worker-api'

/**
 * The host's side of each call into a mod's worker: the stand-in the engine runs for a hook the
 * module registered, and the calls it opened. What the worker asks names its call, and runs in the
 * async context that call was made in (the conversation's scene, a pane's drawing) — the call's
 * own, never one the worker names — so a worker cannot run a `$` call in another call's scene.
 * A call the engine abandoned (`next.signal`) stops waiting on the worker at once.
 */

type Run = <T>(work: () => T) => T

export interface OpenCall {
  api: ModsApi
  next: Next
  streams: Map<number, AsyncGenerator<unknown, unknown, unknown> & { result?: unknown }>
}

/** Contexts kept for what a worker asks after its call answered (a stashed `$`). */
const CONTEXTS_KEPT = 512

export function createCalls(endpoint: Endpoint) {
  let lastCall = 0
  const open = new Map<number, OpenCall>()
  const contexts = new Map<number, Run>()

  function begin(hook: number, $: ModsApi, e: unknown, next: Next) {
    const call = ++lastCall
    open.set(call, { api: $, next, streams: new Map() })
    contexts.set(call, AsyncLocalStorage.snapshot() as Run)
    if (contexts.size > CONTEXTS_KEPT) contexts.delete(contexts.keys().next().value!)
    const abort = () => endpoint.notify('abort', { call })
    next.signal.addEventListener('abort', abort, { once: true })
    const meta: CallMeta = {
      origin: next.origin,
      budget: { ms: next.budget.ms, remainingMs: next.budget.remainingMs },
      ...(next.error ? { error: next.error, called: next.called } : {}),
    }
    return {
      payload: { hook, call, e, shape: shapeOf($), next: meta },
      signal: next.signal,
      close() {
        open.delete(call)
        next.signal.removeEventListener('abort', abort)
      },
    }
  }

  /** A stand-in for the module's hook `spec`: one run of it in the worker per call. */
  function standIn(spec: { id: number; generator: boolean }): Hook {
    const start = ($: ModsApi, e: unknown, next: Next) => begin(spec.id, $, e, next)
    if (spec.generator)
      return async function* ($: ModsApi, e: unknown, next: Next) {
        const { payload, close, signal } = start($, e, next)
        let id: number | undefined
        try {
          const reply = (await endpoint.request('call', payload, signal)) as CallReply
          if ('absent' in reply) return undefined
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
        return 'absent' in reply ? undefined : (reply as { value: unknown }).value
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

/** What the worker answers a call: its value, the stream it yields, or that its matcher missed. */
type CallReply = { value: unknown } | { stream: number } | { absent: true }

/** `$` as the worker rebuilds it: which members are methods, and the values of the rest. */
function shapeOf(api: ModsApi): ApiShape {
  const shape: ApiShape = {}
  for (const [namespace, members] of Object.entries(api)) {
    const own: ApiShape[string] = {}
    for (const [name, member] of Object.entries(members))
      own[name] = typeof member === 'function' ? { fn: true } : { value: member }
    shape[namespace] = own
  }
  return shape
}
