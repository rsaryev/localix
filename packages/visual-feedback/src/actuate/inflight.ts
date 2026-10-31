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
  const track = (url: string, finished: Promise<unknown>): void => {
    try {
      if (!own(url)) return
      const id = ++seq
      started.set(id, clock())
      const done = () => void started.delete(id)
      finished.then(done, done)
    } catch {
      // watching must never reach the page
    }
  }

  const nativeFetch = win.fetch
  if (typeof nativeFetch === 'function') {
    win.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const result = nativeFetch.call(this, input, init)
      track(input instanceof Request ? input.url : String(input), result)
      return result
    } as typeof win.fetch
  }

  const proto = win.XMLHttpRequest?.prototype
  const nativeOpen = proto?.open
  const nativeSend = proto?.send
  const urls = new WeakMap<object, string>()
  if (proto && nativeOpen && nativeSend) {
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      urls.set(this, String(args[1]))
      return (nativeOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.open
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      track(
        urls.get(this) ?? '',
        new Promise((resolve) => this.addEventListener('loadend', resolve, { once: true })),
      )
      return nativeSend.call(this, body)
    }
  }

  return {
    pending: () => {
      const t = clock()
      for (const start of started.values()) if (t - start < maxAgeMs) return true
      return false
    },
    restore: () => {
      if (nativeFetch) win.fetch = nativeFetch
      if (proto && nativeOpen && nativeSend) {
        proto.open = nativeOpen
        proto.send = nativeSend
      }
    },
  }
}
