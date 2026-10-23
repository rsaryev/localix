/**
 * Follow a mini app's realtime stream — subscribe over `miniAppRealtime`, hear frames by tag, know
 * whether the stream is live, and survive a reconnect.
 *
 * Nine mini apps wrote this by hand, and each copy carried its own subset of the same fixes:
 *
 * - A new socket drops every server-side subscription, and the frames sent while it was down are
 *   gone. A copy that did not re-subscribe on reconnect showed a view that silently stopped at the
 *   outage; one that re-subscribed but did not tell its followers left the gap unread.
 * - Two surfaces following one key (a tab and a composer strip) must share ONE subscription, or
 *   the first to leave unsubscribes the other. Followers are refcounted per key here.
 * - `live` must fall the moment the socket drops, not when it comes back: a poll gated on it
 *   otherwise stayed at its slow "the stream has this" cadence for the whole outage.
 * - An answer to a subscribe that was since released, paused or superseded by a reconnect's
 *   re-subscribe is LATE, and must not set `live` for a key that no longer has that subscription.
 * - Frames for every key arrive on one tag: one listener parses each frame once and routes it,
 *   so a follower never sees another key's frames.
 *
 * Liveness comes from one of two places. By default it is the host's answer to the subscribe
 * (`{ subscribed: true }`). A stream whose backend reports its own source (a watch armed, a child
 * running) declares `status`, and then only its status frames set it. A follower is told every
 * CHANGE of its key's liveness; `feed.live(key)` is the state when it joins.
 */
import { useEffect, useRef, useState } from 'react'
import { miniAppRealtime } from './runtime'

export interface RealtimeFeedSpec<Key, Frame> {
  /** The mini app's frame tag: one lowercase character that core does not reserve. */
  readonly tag: string
  /** The subscribe and unsubscribe commands for one key (`{ t: '<app>:x.subscribe', … }`). */
  readonly subscribe: (key: Key) => Record<string, unknown>
  readonly unsubscribe: (key: Key) => Record<string, unknown>
  /** A key's identity; keys with one id share a subscription. Default `String(key)`. */
  readonly id?: (key: Key) => string
  /** Read one frame; `null` or a throw drops it. */
  readonly decode: (json: string) => Frame | null | undefined
  /** Whose followers a frame reaches: a key id, a test over followed keys, or `null` for all. */
  readonly route?: (frame: Frame) => string | ((key: Key) => boolean) | null
  /** For a status frame, whether its source is live; `undefined` for a data frame. */
  readonly status?: (frame: Frame) => boolean | undefined
  /**
   * Unsubscribe every key while the document is hidden and re-subscribe (telling followers to
   * re-read) when it is shown: for a stream that costs the backend a venue socket per key.
   */
  readonly pauseWhileHidden?: boolean
}

export interface RealtimeFeedFollower<Frame> {
  /** A data frame routed to this follower's key. */
  readonly frame?: (frame: Frame) => void
  /** The key's liveness changed. */
  readonly live?: (live: boolean) => void
  /** The key was re-subscribed after a gap (reconnect, or shown again); frames in it are lost. */
  readonly reconnect?: () => void
}

export interface RealtimeFeed<Key, Frame> {
  /** Follow one key; returns the release, which is safe to call twice. */
  follow(key: Key, follower: RealtimeFeedFollower<Frame>): () => void
  /** Whether the key's stream is live now. */
  live(key: Key): boolean
  id(key: Key): string
}

interface Entry<Key, Frame> {
  readonly key: Key
  readonly followers: Set<RealtimeFeedFollower<Frame>>
  live: boolean
  /** Bumped by every subscribe, pause and release: an answer to an older one changes nothing. */
  attempt: number
  paused: boolean
}

const hidden = (): boolean => globalThis.document?.visibilityState === 'hidden'

/** A host without realtime, or without one of its signals: the caller's poll is all there is. */
function guarded(attach: () => () => void): () => void {
  try {
    return attach()
  } catch {
    return () => {}
  }
}

export function createRealtimeFeed<Key = string, Frame = unknown>(
  spec: RealtimeFeedSpec<Key, Frame>,
): RealtimeFeed<Key, Frame> {
  const idOf = spec.id ?? ((key: Key) => String(key))
  const entries = new Map<string, Entry<Key, Frame>>()
  let detach: (() => void) | null = null

  const send = (payload: Record<string, unknown>): Promise<boolean> => {
    try {
      return miniAppRealtime.request<{ subscribed?: boolean } | undefined>(payload).then(
        (answer) => answer?.subscribed === true,
        () => false,
      )
    } catch {
      return Promise.resolve(false)
    }
  }
  const current = (entry: Entry<Key, Frame>) => entries.get(idOf(entry.key)) === entry
  const setLive = (entry: Entry<Key, Frame>, live: boolean) => {
    if (entry.live === live) return
    entry.live = live
    // A snapshot: a follower's callback may release itself or another.
    for (const follower of Array.from(entry.followers)) follower.live?.(live)
  }
  const subscribe = (entry: Entry<Key, Frame>) => {
    entry.paused = false
    const attempt = ++entry.attempt
    void send(spec.subscribe(entry.key)).then((accepted) => {
      if (!spec.status && entry.attempt === attempt && current(entry)) setLive(entry, accepted)
    })
  }
  const resubscribe = (entry: Entry<Key, Frame>) => {
    subscribe(entry)
    for (const follower of Array.from(entry.followers)) follower.reconnect?.()
  }

  const onFrame = (json: string) => {
    let frame: Frame | null | undefined
    try {
      frame = spec.decode(json)
    } catch {
      return
    }
    if (frame === null || frame === undefined) return
    const target = spec.route ? spec.route(frame) : null
    const status = spec.status?.(frame)
    const reached =
      typeof target === 'string'
        ? [entries.get(target)]
        : Array.from(entries.values()).filter((entry) => !target || target(entry.key))
    for (const entry of reached) {
      if (!entry || entry.paused) continue
      if (status !== undefined) setLive(entry, status)
      else for (const follower of Array.from(entry.followers)) follower.frame?.(frame)
    }
  }
  const onDisconnect = () => {
    for (const entry of Array.from(entries.values())) setLive(entry, false)
  }
  const onReconnect = () => {
    for (const entry of Array.from(entries.values())) {
      setLive(entry, false)
      // A paused key re-subscribes, and its followers re-read, when it is shown again.
      if (current(entry) && !entry.paused) resubscribe(entry)
    }
  }
  const onVisibility = () => {
    const isHidden = hidden()
    for (const entry of Array.from(entries.values())) {
      if (isHidden && !entry.paused) {
        entry.paused = true
        entry.attempt++
        setLive(entry, false)
        void send(spec.unsubscribe(entry.key))
      } else if (!isHidden && entry.paused && current(entry)) resubscribe(entry)
    }
  }
  const attach = (): (() => void) => {
    const offs = [
      guarded(() => miniAppRealtime.onFrame(spec.tag, onFrame)),
      guarded(() => miniAppRealtime.onReconnect(onReconnect)),
      guarded(() => miniAppRealtime.onDisconnect(onDisconnect)),
    ]
    if (spec.pauseWhileHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
      offs.push(() => document.removeEventListener('visibilitychange', onVisibility))
    }
    return () => offs.forEach((off) => off())
  }

  return {
    id: idOf,
    live: (key) => entries.get(idOf(key))?.live ?? false,
    follow(key, follower) {
      detach ??= attach()
      const id = idOf(key)
      let entry = entries.get(id)
      if (!entry) {
        entry = { key, followers: new Set(), live: false, attempt: 0, paused: false }
        entries.set(id, entry)
        if (spec.pauseWhileHidden && hidden()) entry.paused = true
        else subscribe(entry)
      }
      entry.followers.add(follower)
      const own = entry
      let released = false
      return () => {
        if (released) return
        released = true
        if (!own.followers.delete(follower) || own.followers.size > 0) return
        if (current(own)) entries.delete(id)
        own.attempt++
        if (!own.paused) void send(spec.unsubscribe(own.key))
        if (entries.size === 0) {
          detach?.()
          detach = null
        }
      }
    },
  }
}

/**
 * {@link RealtimeFeed.follow} for a component: follows `key` while it is not `null` and returns
 * whether its stream is live. The follower's handlers may change identity on every render; only
 * the key's id re-follows.
 */
export function useRealtimeFeed<Key, Frame>(
  feed: RealtimeFeed<Key, Frame>,
  key: Key | null,
  follower: RealtimeFeedFollower<Frame> = {},
): boolean {
  const latest = useRef({ follower, key })
  useEffect(() => {
    latest.current = { follower, key }
  })
  const id = key === null ? null : feed.id(key)
  const [live, setLive] = useState<{ id: string; live: boolean } | null>(null)
  useEffect(() => {
    const followed = latest.current.key
    if (id === null || followed === null) return
    const release = feed.follow(followed, {
      frame: (frame) => latest.current.follower.frame?.(frame),
      live: (next) => {
        setLive({ id, live: next })
        latest.current.follower.live?.(next)
      },
      reconnect: () => latest.current.follower.reconnect?.(),
    })
    setLive({ id, live: feed.live(followed) })
    return () => {
      release()
      setLive(null)
    }
  }, [feed, id])
  // A value for another key (the hook moved on) says nothing about this one.
  return live?.id === id ? live.live : false
}
