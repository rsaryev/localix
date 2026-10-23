import { useEffect, useRef, useSyncExternalStore } from 'react'

import { createResourceSync } from './resource-sync'
import { runAsBackgroundWork } from './visibility'
import { resourceKeyAffected, type ResourceTopic } from './resource-topics'

/**
 * One list, fetched once, read by everyone — the data half of a `StatusItemContribution`.
 *
 * A status item's hook runs on every render of the bar it sits in, and that bar re-renders
 * whenever any tab moves. A fetch owned by the render therefore runs again and again for an
 * answer nobody asked to change, which is precisely what the contribution contract forbids. But
 * most mini apps have something worth showing that no existing store already holds — the saved
 * environments, the connections, the shelf — and writing the cache by hand each time produced the
 * same forty lines of `Map` + `inFlight` + listener set in every mini app that tried.
 *
 * So it lives here once. A resource keeps one value per key, fetches a key at most once, and hands
 * every reader the same answer.
 *
 * Deliberately NOT a poller. There is no interval and no way to ask for one: a status item is an
 * affordance, and a background request per second to re-learn what the mini app itself caused is
 * the cost the contract exists to prevent. The two moments that actually move a list — opening the
 * surface that owns it, and the mini app performing the action that changes it — are announced, not
 * polled for: give the resource a {@link ResourceTopic} and every writer that invalidates it
 * re-reads this resource by construction. That is the half a mini app used to have to remember, and
 * two of the five that tried never finished wiring.
 *
 * A failed load keeps the last good value. The item is an affordance, not a report: showing a
 * slightly stale connection name beats the control vanishing because one request lost.
 */
export interface SharedResource<T> {
  /**
   * Subscribe to a key's value from a component, fetching it the first time it is asked for.
   *
   * `undefined` means "not loaded yet" — distinct from a loaded-but-empty value, so a caller can
   * tell "still asking" from "you have none". A `null`/empty key fetches nothing and stays
   * `undefined`: a session-scoped resource with no session has nothing to address.
   */
  use(key: string | null | undefined): T | undefined
  /** Re-read a key after something known to have changed it. A change during an in-flight read causes one fresh follow-up. */
  refresh(key: string): void
  /** The current value without subscribing — for a callback that needs the latest, not a render. */
  peek(key: string | null | undefined): T | undefined
  /** Listen outside React. Returns the unsubscribe; the hook above is built on this. */
  subscribe(listener: () => void): () => void
  /** Drop everything. For teardown and for tests, which must not inherit a previous case's value. */
  reset(): void
  /** Stop following the topic. Only for teardown — a live resource is meant to keep listening. */
  dispose(): void
}

export interface SharedResourceOptions {
  /**
   * The topic whose invalidation re-reads this resource.
   *
   * Wiring it here rather than at each call site is the point: a reader that has to remember to
   * subscribe is a reader that will one day be built without one, which is exactly how two of the
   * bundled mini apps ended up with a titlebar showing whatever was true when the app started.
   *
   * Only registered readers, including an initial read in flight, are re-read. A key nobody has asked for has no value to correct, and
   * fetching it because something changed would turn an invalidation into a request per mini app
   * per session.
   */
  topic?: ResourceTopic
}

/**
 * The key an app-global resource is stored under.
 *
 * Most mini app data is not session-scoped — a machine has one set of saved connections whichever
 * chat is on screen. Such a resource still needs A key, and every mini app inventing its own string
 * for "the only one" is noise. Session-scoped resources pass the session id instead.
 */
export const GLOBAL_RESOURCE_KEY = 'global'

export function createSharedResource<T>(
  load: (key: string, signal?: AbortSignal) => Promise<T>,
  options: SharedResourceOptions = {},
): SharedResource<T> {
  const values = new Map<string, T>()
  const readers = new Map<string, () => void>()
  const sync = createResourceSync<string>({ retryDelaysMs: [] })
  sync.connected()
  const listeners = new Set<() => void>()
  // A counter, not the map: `useSyncExternalStore` compares snapshots by identity, and a Map
  // mutated in place is its own previous value. Bumping a number is the whole change signal.
  let version = 0

  const read = (key: string): void => {
    if (readers.has(key)) {
      sync.invalidate([key])
      return
    }
    readers.set(
      key,
      sync.register(key, {
        read: (signal) => runAsBackgroundWork(() => load(key, signal)),
        apply: (value) => {
          values.set(key, value)
          version++
          for (const listener of listeners) listener()
        },
      }),
    )
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const snapshot = (): number => version

  // Only registered readers, and only what the key says moved — see `SharedResourceOptions.topic`.
  const unfollow = options.topic?.subscribe((changed) => {
    for (const key of Array.from(readers.keys())) {
      if (resourceKeyAffected(key, changed)) read(key)
    }
  })

  return {
    use(key) {
      // Read so the subscription is a real dependency of this render rather than decoration:
      // without it React has no reason to re-run the component when the value lands. The third
      // argument is the server snapshot — omitting it makes React warn rather than assume.
      const observedVersion = useSyncExternalStore(subscribe, snapshot, snapshot)
      useEffect(() => {
        // `has`, not a truthiness check: the fetch is owed once per key, and re-running it
        // because the answer happened to be an empty list is the bug this guard exists for.
        if (key && !values.has(key)) read(key)
      }, [key, observedVersion])
      return key ? values.get(key) : undefined
    },
    refresh(key) {
      if (key) read(key)
    },
    peek(key) {
      return key ? values.get(key) : undefined
    },
    subscribe,
    reset() {
      values.clear()
      for (const stop of readers.values()) stop()
      readers.clear()
      version += 1
      for (const listener of listeners) listener()
    },
    dispose() {
      unfollow?.()
      listeners.clear()
      values.clear()
      for (const stop of readers.values()) stop()
      readers.clear()
    },
  }
}

/**
 * Follow a topic from a component that is NOT backed by a {@link SharedResource}.
 *
 * The escape hatch for a surface with its own state — an editor holding a draft, a picker doing an
 * optimistic flip — that still has to hear about a change made elsewhere. It is the same protocol,
 * so such a surface and the status item beside it cannot disagree about when to look again.
 *
 * `key` narrows it to one session or scope; leave it out to hear every invalidation of the topic.
 */
export function useResourceTopic(
  topic: ResourceTopic,
  onChange: () => void,
  key?: string | null,
): void {
  // A ref, so a caller may pass an inline closure without re-subscribing on every render — the
  // shape every one of these call sites actually has.
  const handler = useRef(onChange)
  handler.current = onChange
  useEffect(
    () =>
      topic.subscribe((changed) => {
        if (resourceKeyAffected(key, changed)) handler.current()
      }),
    [topic, key],
  )
}
