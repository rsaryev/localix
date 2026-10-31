/**
 * The page's own requests in flight (fetch and XHR to its origin), by start time. Results a
 * search asked for arrive this way, after the DOM has gone quiet. Third-party traffic (ads,
 * analytics) never ends and is not the page's content; a request older than `maxAgeMs` is a
 * long poll.
 *
 * This runs on real sites: both entry points are wrapped passively. The page's call goes to the
 * original function with the same `this` and arguments and gets the original result back; the
 * tracker only listens, and never throws into the page.
 */
import { now } from './settle'

export interface InflightTracker {
  /** An own-origin request younger than the max age has not finished. */
  pending: () => boolean
  /** Put the original fetch and XHR methods back. */
  restore: () => void
}

/** A request older than this is a long poll, not a result the page is about to show. */
export const INFLIGHT_MAX_AGE_MS = 5000

export function installInflightTracker(
  win: Window & typeof globalThis,
  clock: () => number = now,
  maxAgeMs = INFLIGHT_MAX_AGE_MS,
): InflightTracker {
  const started = new Map<number, number>()
  let seq = 0
  const own = (url: string): boolean => {
    try {
      return new URL(url, win.location.href).origin === win.location.origin
    } catch {
      return false
    }
  }
  /** Count a request from now; the returned function ends it. A no-op for what is not counted. */
  const track = (url: string): (() => void) => {
    try {
      if (!own(url)) return () => {}
      const id = ++seq
      started.set(id, clock())
      return () => void started.delete(id)
    } catch {
      // watching must never reach the page
      return () => {}
    }
  }

  const nativeFetch = win.fetch
  let wrappedFetch: typeof win.fetch | undefined
  if (typeof nativeFetch === 'function') {
    win.fetch = wrappedFetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      const end = track(input instanceof Request ? input.url : String(input))
      let result: ReturnType<typeof nativeFetch>
      try {
        result = nativeFetch.call(this, input, init)
      } catch (error) {
        end()
        throw error
      }
      result.then(end, end)
      return result
    } as typeof win.fetch
  }

  const proto = win.XMLHttpRequest?.prototype
  const nativeOpen = proto?.open
  const nativeSend = proto?.send
  const urls = new WeakMap<object, string>()
  let wrappedOpen: typeof nativeOpen
  let wrappedSend: typeof nativeSend
  if (proto && nativeOpen && nativeSend) {
    proto.open = wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      urls.set(this, String(args[1]))
      return (nativeOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.open
    proto.send = wrappedSend = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const end = track(urls.get(this) ?? '')
      this.addEventListener('loadend', end, { once: true })
      try {
        return nativeSend.call(this, body)
      } catch (error) {
        // A send that throws never reaches loadend.
        end()
        throw error
      }
    }
  }

  return {
    pending: () => {
      const t = clock()
      for (const start of started.values()) if (t - start < maxAgeMs) return true
      return false
    },
    // Only what is still ours: a page that wrapped these after us keeps its wrapper.
    restore: () => {
      if (nativeFetch && win.fetch === wrappedFetch) win.fetch = nativeFetch
      if (proto && nativeOpen && nativeSend) {
        if (proto.open === wrappedOpen) proto.open = nativeOpen
        if (proto.send === wrappedSend) proto.send = nativeSend
      }
    },
  }
}
