import { loadNativeWatcher, type AsyncSubscription, type NativeWatchEvent } from './native-binding'

export type { NativeWatchEvent }

export interface NativeSubscriptionHandle {
  close(): void
}

export interface NativeSubscribeOptions {
  /** Paths, globs or flagless RegExps, matched RELATIVE to the subscribed root. */
  ignore?: (string | RegExp)[]
  /**
   * The addon could not load (reported synchronously, before this returns), the subscription
   * was refused, or the backend reported an error — including a dropped-events overflow, which
   * FSEvents and inotify both report rather than going quiet. Never called after `close`.
   */
  onError?: (err: unknown) => void
}

/**
 * ONE native recursive subscription (`native-binding.ts`), for every watcher in the server and
 * the dev scripts.
 *
 * The subscription is asynchronous while its handle is not, and each caller that wired the
 * addon itself had to get the same two edges right: a `close` that lands BEFORE the
 * subscription resolves must still unsubscribe it once it does — otherwise a live FSEvents
 * stream or a tree of inotify watches outlives its owner with nothing left to stop it — and an
 * error arriving after `close` belongs to nobody and must not be reported. Both are decided
 * here, once.
 */
export function subscribeNative(
  root: string,
  onEvents: (events: NativeWatchEvent[]) => void,
  opts: NativeSubscribeOptions = {},
): NativeSubscriptionHandle {
  let closed = false
  let subscription: AsyncSubscription | null = null
  const fail = (err: unknown) => {
    if (!closed) opts.onError?.(err)
  }

  const native = loadNativeWatcher()
  if (native instanceof Error) {
    fail(native)
    return { close() {} }
  }

  native
    .subscribe(
      root,
      (err, events) => {
        if (closed) return
        if (err) {
          fail(err)
          return
        }
        onEvents(events)
      },
      opts.ignore ? { ignore: opts.ignore } : undefined,
    )
    .then(
      (sub) => {
        if (closed) void sub.unsubscribe().catch(() => {})
        else subscription = sub
      },
      (err) => fail(err),
    )

  return {
    close() {
      closed = true
      const sub = subscription
      subscription = null
      if (sub) void sub.unsubscribe().catch(() => {})
    },
  }
}
