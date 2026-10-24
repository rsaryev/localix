import {
  COUNTED_CALLS,
  SYNC_CALLS,
  elementTable,
  matchesEventName,
} from '@localixai/claude-plugin/mods'
import type { ApiShape, CallMeta, NextReply } from '../call-protocol'
import type { Endpoint } from '../endpoint'

/**
 * A hook's `$` and `next` inside the mod's VM, standing in for the host's: each `$` call and each
 * `next` is a request to the host, which answers it with the `$` and `next` of that hook's run —
 * so a call on `$` stashed past its hook (a timer, a button) still reaches the mod's own `$`.
 *
 * Claude Code keeps a few calls synchronous (`$.ui.resolve`, `$.clock.after`): `ui.resolve`
 * answers from the element tables the host sent at load, a timer answers a `cancel` at once, and
 * the others are sent without waiting. `next(e)` answers a promise that is also the stream of a
 * streaming event (`turn.step`): `await next(e)` is the result, `yield* next(e)` the chunks.
 */

type Fn = (...args: unknown[]) => unknown

/** A hook run's own time, as `next.budget.remainingMs` reads it: it stops while the host works. */
function createMeter(remainingMs: number) {
  let remaining = remainingMs
  let since = Date.now()
  let waits = 0
  return {
    async wait<T>(inner: Promise<T>): Promise<T> {
      if (waits++ === 0) remaining -= Date.now() - since
      try {
        return await inner
      } finally {
        if (--waits === 0) since = Date.now()
      }
    },
    remainingMs: () => Math.max(0, waits > 0 ? remaining : remaining - (Date.now() - since)),
  }
}

export function createGuestApi(endpoint: Endpoint) {
  const controllers = new Map<number, AbortController>()
  const meters = new Map<number, ReturnType<typeof createMeter>>()
  let tables = new Map<string, Record<string, unknown>>()

  const passThrough = { wait: <T>(inner: Promise<T>) => inner }
  const meterOf = (call: number) => meters.get(call) ?? passThrough

  function method(call: number, namespace: string, name: string): Fn {
    const event = `${namespace}.${name}`
    const send = (args: unknown[]) =>
      endpoint.request('api', { call, path: [namespace, name], args })
    if (event === 'ui.resolve')
      return (e) => {
        const component = (e as { component?: unknown } | undefined)?.component
        return (typeof component === 'string' && tables.get(component)) || elementTable()
      }
    if (SYNC_CALLS.has(event))
      return (...args) => {
        const pending = send(args)
        pending.catch(() => {})
        if (namespace !== 'clock') return undefined
        return {
          cancel: () =>
            void pending.then((timer) => (timer as { cancel?: Fn } | undefined)?.cancel?.()),
        }
      }
    if (COUNTED_CALLS.has(event)) return (...args) => send(args)
    return (...args) => meterOf(call).wait(send(args))
  }

  /** `next(e)`'s answer: a promise of the result that streams the chunks as well. */
  function streamOf(call: number, reply: Promise<NextReply>) {
    const result = reply.then((answer) =>
      'stream' in answer
        ? endpoint.request('stream.result', { call, id: answer.stream })
        : answer.value,
    )
    // Read or not, a failed `next` is the hook's to handle, never an unhandled rejection.
    result.catch(() => {})
    async function* chunks(): AsyncGenerator<unknown, unknown, unknown> {
      const answer = await reply
      if (!('stream' in answer)) return answer.value
      for (;;) {
        const step = (await endpoint.request('stream.next', { call, id: answer.stream })) as {
          done: boolean
          value: unknown
        }
        if (step.done) return step.value
        yield step.value
      }
    }
    let body: AsyncGenerator<unknown, unknown, unknown> | undefined
    const read = () => (body ??= chunks())
    return Object.assign(result, {
      result,
      [Symbol.asyncIterator]: read,
      next: (value?: unknown) => read().next(value),
      return: (value?: unknown) => read().return(value),
      throw: (error?: unknown) => read().throw(error),
    })
  }

  return {
    /** The `$` a hook run gets, by the host's description of it. */
    dollar(call: number, shape: ApiShape): Record<string, Record<string, unknown>> {
      const $: Record<string, Record<string, unknown>> = {}
      for (const [namespace, members] of Object.entries(shape)) {
        const own: Record<string, unknown> = {}
        for (const [name, member] of Object.entries(members))
          own[name] = 'fn' in member ? method(call, namespace, name) : member.value
        $[namespace] = own
      }
      return $
    },

    next(call: number, meta: CallMeta) {
      const controller = new AbortController()
      const meter = createMeter(meta.budget.remainingMs)
      controllers.set(call, controller)
      meters.set(call, meter)
      let trace: unknown = []
      const run = (e: unknown, tier?: unknown) => {
        trace = []
        const reply = meter.wait(endpoint.request('next', { call, e, tier }) as Promise<NextReply>)
        void reply.then(
          (answer) =>
            void ('trace' in answer && Array.isArray(answer.trace) && (trace = answer.trace)),
          () => {},
        )
        return streamOf(call, reply)
      }
      const event = typeof meta.event === 'string' ? meta.event : ''
      const next = Object.assign((e?: unknown) => run(e), {
        to: (e: unknown, tier: unknown) => run(e, tier),
        signal: controller.signal,
        origin: meta.origin,
        event,
        is: (pattern: unknown) => matchesEventName(String(pattern), event),
        budget: {
          ms: meta.budget.ms,
          get remainingMs() {
            return meter.remainingMs()
          },
        },
        ...(meta.error === undefined ? {} : { error: meta.error, called: meta.called }),
      })
      // Read fresh: the trace the host sent back with the latest call's answer.
      return Object.defineProperty(next, 'trace', { get: () => trace })
    },

    /** The host abandoned the call's event: its `next.signal` aborts. */
    abort(call: number) {
      controllers.get(call)?.abort(new Error('the event was abandoned'))
    },

    /** The call answered; a late `$` call from it still goes to the host. */
    ended(call: number) {
      controllers.delete(call)
      meters.delete(call)
    },

    setTables(next: Record<string, Record<string, unknown>>) {
      tables = new Map(Object.entries(next))
    },
  }
}
