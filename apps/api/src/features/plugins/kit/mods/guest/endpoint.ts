import { decode, encode, type WireLimits, type WireTable } from './wire'

/**
 * One side of the channel between the mods host and a mod's VM: requests that answer, notes
 * that do not, and the functions each side lends the other (`wire.ts`). Both sides run the same
 * endpoint. No frame carries a context: the host runs what a VM asks in the context of the
 * call the request names (`mod-vm.ts`), never one the VM picks. A stand-in the receiving
 * side drops is released, and the owner forgets the function; a closed endpoint rejects whatever
 * is still waiting, and a request whose signal aborts rejects at once.
 *
 * What arrives is not trusted (the VM runs a mod's code): a frame that does not decode, or
 * holds more than `limits`, fails only its own request — the waiting request rejects, a request is
 * answered with the error — and a frame that is no message of this channel goes to `malformed`,
 * never a throw of `receive`.
 */

export type Message =
  | { t: 'req'; id: number; type: string; payload: unknown }
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: unknown }
  | { t: 'note'; type: string; payload: unknown }
  | { t: 'release'; id: number }

export type Handler = (payload: never) => unknown

export interface EndpointOptions {
  post: (message: Message) => void
  handlers: Record<string, Handler>
  /** What one value from the other side may hold; absent, only the nesting is bounded. */
  limits?: WireLimits
  /** Wraps the built-in handler of the other side's calls of this side's functions. */
  builtIns?: { invoke?: (handler: Handler) => Handler }
  /** A frame that is no message of this channel arrived; the other side is not to be trusted. */
  malformed?: (reason: string) => void
}

export interface Endpoint {
  /** Answers what the other side's handler did; rejects with `signal`'s reason once it aborts. */
  request(type: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
  notify(type: string, payload: unknown): void
  /** Never throws: what does not decode fails its own request (see above). */
  receive(message: unknown): void
  /** Rejects every waiting request with `error`; later ones reject at once. */
  close(error: Error): void
}

export function createEndpoint(options: EndpointOptions): Endpoint {
  const { post, handlers, limits } = options
  let lastId = 0
  let closed: Error | null = null
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  const kept = new Map<number, (...args: unknown[]) => unknown>()
  const keptIds = new WeakMap<object, number>()
  const standIns = new Map<number, WeakRef<(...args: unknown[]) => unknown>>()
  const standInIds = new WeakMap<object, number>()
  const released = new FinalizationRegistry<number>((id) => {
    if (standIns.get(id)?.deref() !== undefined) return
    standIns.delete(id)
    if (!closed) post({ t: 'release', id })
  })

  const table: WireTable = {
    keep(fn) {
      const known = keptIds.get(fn)
      if (known !== undefined && kept.has(known)) return known
      const id = ++lastId
      kept.set(id, fn)
      keptIds.set(fn, id)
      return id
    },
    idOfStandIn: (fn) => (typeof fn === 'function' ? standInIds.get(fn) : undefined),
    standIn(id) {
      const known = standIns.get(id)?.deref()
      if (known) return known
      const fn = (...args: unknown[]) => endpoint.request('invoke', { id, args })
      standIns.set(id, new WeakRef(fn))
      standInIds.set(fn, id)
      released.register(fn, id)
      return fn
    },
    kept(id) {
      const fn = kept.get(id)
      if (!fn) return () => Promise.reject(new Error('the function was released'))
      return fn
    },
  }

  const invoke = (({ id, args }: { id: number; args: unknown[] }) => {
    const fn = kept.get(id)
    if (!fn) throw new Error('the function was released')
    if (!Array.isArray(args)) throw new Error('a function was called without arguments')
    return fn(...args)
  }) as Handler
  const builtIn: Record<string, Handler> = {
    invoke: options.builtIns?.invoke?.(invoke) ?? invoke,
  }

  const answer = async (id: number, type: string, payload: unknown) => {
    let message: Message
    try {
      const handler = handlerOf(type) ?? (Object.hasOwn(builtIn, type) ? builtIn[type] : undefined)
      if (!handler) throw new Error(`no handler for ${type}`)
      const value = await handler(decode(payload, table, limits) as never)
      message = { t: 'res', id, ok: true, value: encode(value, table) }
    } catch (error) {
      message = { t: 'res', id, ok: false, error: encode(asError(error), table) }
    }
    if (closed) return
    try {
      post(message)
    } catch (error) {
      // What the handler answered is not data the channel carries (a class instance, a stream).
      post({ t: 'res', id, ok: false, error: encode(asError(error), table) })
    }
  }

  const handlerOf = (type: string) => (Object.hasOwn(handlers, type) ? handlers[type] : undefined)

  /** `decode` of what arrived, or the `WireError` it threw as the value of a failure. */
  const decoded = (value: unknown): { ok: true; value: unknown } | { ok: false; error: Error } => {
    try {
      return { ok: true, value: decode(value, table, limits) }
    } catch (error) {
      return { ok: false, error: asError(error) }
    }
  }

  const endpoint: Endpoint = {
    request(type, payload, signal) {
      if (closed) return Promise.reject(closed)
      if (signal?.aborted) return Promise.reject(asError(signal.reason))
      const id = ++lastId
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (!waiting.delete(id)) return
          reject(asError(signal!.reason))
        }
        const settle =
          <T>(done: (value: T) => void) =>
          (value: T) => {
            signal?.removeEventListener('abort', abort)
            done(value)
          }
        waiting.set(id, { resolve: settle(resolve), reject: settle(reject) })
        signal?.addEventListener('abort', abort, { once: true })
        try {
          post({ t: 'req', id, type, payload: encode(payload, table) })
        } catch (error) {
          waiting.delete(id)
          settle(reject)(asError(error))
        }
      })
    },
    notify(type, payload) {
      if (!closed) post({ t: 'note', type, payload: encode(payload, table) })
    },
    receive(frame) {
      if (closed) return
      const reason = malformedReason(frame)
      if (reason) {
        options.malformed?.(reason)
        return
      }
      const message = frame as Message
      switch (message.t) {
        case 'req':
          void answer(message.id, message.type, message.payload)
          return
        case 'res': {
          const pending = waiting.get(message.id)
          if (!pending) return
          waiting.delete(message.id)
          const got = decoded(message.ok ? message.value : message.error)
          if (got.ok && message.ok) pending.resolve(got.value)
          else pending.reject(got.ok ? got.value : got.error)
          return
        }
        case 'note': {
          const handler = handlerOf(message.type)
          if (handler)
            try {
              const done = handler(decode(message.payload, table, limits) as never)
              void Promise.resolve(done).catch(() => {})
            } catch {
              // A note has no one to answer; its handler reports what matters itself.
            }
          return
        }
        case 'release':
          kept.delete(message.id)
      }
    },
    close(error) {
      if (closed) return
      closed = error
      for (const pending of waiting.values()) pending.reject(error)
      waiting.clear()
      kept.clear()
    },
  }
  return endpoint
}

const isId = (id: unknown) => Number.isSafeInteger(id)

/** Why `frame` is no message of this channel, or undefined when it is one. */
function malformedReason(frame: unknown): string | undefined {
  if (frame === null || typeof frame !== 'object') return 'a frame that is not a message'
  const message = frame as Record<string, unknown>
  const typed = typeof message.type === 'string'
  const valid =
    message.t === 'req'
      ? isId(message.id) && typed
      : message.t === 'res'
        ? isId(message.id) && typeof message.ok === 'boolean'
        : message.t === 'note'
          ? typed
          : message.t === 'release' && isId(message.id)
  return valid ? undefined : `a malformed ${String(message.t).slice(0, 20)} message`
}

export const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
