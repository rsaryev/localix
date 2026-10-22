/**
 * The web APIs a hooks module may use that QuickJS and its extensions lack: `AbortController`,
 * `AbortSignal`, `Event` and `EventTarget`, as Claude Code documents a hooks module's world. Small
 * and standard in what they do; installed as globals before the VM freezes its built-ins, and used
 * by the runtime itself for `next.signal`.
 */

type Listener = ((event: GuestEvent) => unknown) | { handleEvent(event: GuestEvent): unknown }

class GuestEvent {
  readonly type: string
  defaultPrevented = false
  target: GuestEventTarget | null = null
  currentTarget: GuestEventTarget | null = null
  constructor(type: string) {
    this.type = String(type)
  }
  preventDefault() {
    this.defaultPrevented = true
  }
}

class GuestEventTarget {
  #listeners = new Map<string, Array<{ listener: Listener; once: boolean }>>()

  addEventListener(
    type: string,
    listener: Listener | null,
    options?: boolean | { once?: boolean },
  ) {
    if (!listener) return
    const list = this.#listeners.get(type) ?? []
    if (list.some((entry) => entry.listener === listener)) return
    const once = typeof options === 'object' && options !== null && options.once === true
    list.push({ listener, once })
    this.#listeners.set(type, list)
  }

  removeEventListener(type: string, listener: Listener | null) {
    const list = this.#listeners.get(type)
    if (list)
      this.#listeners.set(
        type,
        list.filter((entry) => entry.listener !== listener),
      )
  }

  dispatchEvent(event: GuestEvent): boolean {
    event.target = this
    event.currentTarget = this
    for (const entry of (this.#listeners.get(event.type) ?? []).slice()) {
      if (entry.once) this.removeEventListener(event.type, entry.listener)
      if (typeof entry.listener === 'function') entry.listener.call(this, event)
      else entry.listener.handleEvent(event)
    }
    event.currentTarget = null
    return !event.defaultPrevented
  }
}

/** Lets only this file construct a signal, as `new AbortSignal()` refuses in a browser. */
const INTERNAL = Symbol('internal')

const abortError = () => new DOMException('This operation was aborted', 'AbortError')

class GuestAbortSignal extends GuestEventTarget {
  aborted = false
  reason: unknown = undefined
  onabort: ((event: GuestEvent) => unknown) | null = null

  constructor(token?: symbol) {
    super()
    if (token !== INTERNAL) throw new TypeError('Illegal constructor')
  }

  throwIfAborted() {
    if (this.aborted) throw this.reason
  }

  static abort(reason?: unknown): GuestAbortSignal {
    const signal = new GuestAbortSignal(INTERNAL)
    abortSignal(signal, reason)
    return signal
  }

  static any(signals: Iterable<GuestAbortSignal>): GuestAbortSignal {
    const combined = new GuestAbortSignal(INTERNAL)
    for (const signal of signals) {
      if (signal.aborted) {
        abortSignal(combined, signal.reason)
        break
      }
      signal.addEventListener('abort', () => abortSignal(combined, signal.reason), { once: true })
    }
    return combined
  }
}

function abortSignal(signal: GuestAbortSignal, reason: unknown) {
  if (signal.aborted) return
  signal.aborted = true
  signal.reason = reason === undefined ? abortError() : reason
  const event = new GuestEvent('abort')
  signal.onabort?.call(signal, event)
  signal.dispatchEvent(event)
}

class GuestAbortController {
  readonly signal = new GuestAbortSignal(INTERNAL)
  abort(reason?: unknown) {
    abortSignal(this.signal, reason)
  }
}

/** Defines the web APIs above as globals, where the VM has none of its own by those names. */
export function installWebApis(global: Record<string, unknown>): void {
  const apis = {
    Event: GuestEvent,
    EventTarget: GuestEventTarget,
    AbortSignal: GuestAbortSignal,
    AbortController: GuestAbortController,
  }
  for (const [name, api] of Object.entries(apis))
    if (!(name in global))
      Object.defineProperty(global, name, { value: api, writable: true, configurable: true })
}
