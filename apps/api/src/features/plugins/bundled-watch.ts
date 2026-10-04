import { realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { subscribeNative } from '../fs-watch/subscribe'
import { STAGED_MARKER_FILE } from './staged-marker'

/**
 * Push, where bundled-plugin synchronization is pull.
 *
 * `syncBundledPlugins` runs when something asks for the plugin catalog, and it memoizes for
 * ten seconds. A plugin re-staged while the API runs (a scaffold, a backend edit) therefore
 * reached the API only when somebody next asked AND the memo had expired — in practice, when
 * the user typed `/plugin reload` and then waited. The staged root announces every change by
 * rewriting one marker file; watching that file turns the change into the same `onChanged`
 * a plugin toggle raises, so the catalog, the hosts and every connected client converge on
 * their own.
 *
 * Only the marker is the signal: staging writes many files and the marker LAST, so the marker
 * is the one event that means "complete".
 *
 * The watch is the NATIVE watcher (`fs-watch/subscribe.ts`), not `node:fs` `watch`. On macOS
 * Bun's directory watch stopped delivering with no error — measured: after a burst of re-stages
 * the API logged nothing for a marker rewritten minutes later, or for a direct `touch` of it —
 * and a burst could report the marker's event under another entry's name. Either way the next
 * build never reached the API, and a plugin whose last sync had failed stayed missing until a
 * restart. That is why a 2s `stat` poll ran beside it, for good. The native watcher reports
 * every path it sees and REPORTS a loss instead of going quiet (FSEvents' and inotify's
 * dropped-events overflow both arrive as errors), so the poll is no longer a permanent second
 * watcher: it is the fallback a failure switches to — no addon on this platform, a refused
 * subscription, or a reported drop (which also re-reads the marker at once, since the drop may
 * have swallowed its rewrite).
 */
export const STAGED_MARKER_POLL_MS = 2000

/**
 * Everything below the root's top level. The marker lives AT the top, and the staged plugin
 * trees under it are never the signal; ignoring them keeps an inotify backend from adding a
 * kernel watch for every staged directory. Matched relative to the subscribed root.
 */
const NESTED_ENTRY = /[\\/]/

const isMarkerName = (name: string) =>
  name === STAGED_MARKER_FILE ||
  // Bun/macOS may report only the SOURCE of an atomic rename, `<marker>.<pid>.tmp`. Read the
  // final marker after the debounce: an unfinished temp write is never a build.
  (name.startsWith(`${STAGED_MARKER_FILE}.`) && name.endsWith('.tmp'))

export interface StagedRootWatch {
  close: () => void
}

export function watchStagedPluginsRoot({
  root,
  onChange,
  log = () => {},
  debounceMs = 300,
  pollMs = STAGED_MARKER_POLL_MS,
  subscribe = subscribeNative,
  setTimer = setTimeout,
  every = (fn: () => void, ms: number) => {
    const handle = setInterval(fn, ms)
    handle.unref?.()
    return () => clearInterval(handle)
  },
  revision = () => {
    try {
      const stat = statSync(join(root, STAGED_MARKER_FILE), { bigint: true })
      return `${stat.ino}:${stat.mtimeNs}:${stat.size}`
    } catch {
      return null
    }
  },
}: {
  root: string
  /** Called once per settled marker rewrite; expected to invalidate the sync and re-announce. */
  onChange: () => void
  log?: (line: string) => void
  debounceMs?: number
  pollMs?: number
  subscribe?: typeof subscribeNative
  setTimer?: typeof setTimeout
  /** Run `fn` every `ms`; returns the stop. */
  every?: (fn: () => void, ms: number) => () => void
  revision?: () => string | null
}): StagedRootWatch {
  let timer: ReturnType<typeof setTimeout> | null = null
  let current = revision()
  let stopPolling: (() => void) | null = null
  let closed = false
  /** The one decision the watch and the fallback poll both make: did the marker move? */
  const check = () => {
    const next = revision()
    if (next === null || next === current) return
    current = next
    onChange()
  }
  const degrade = (error: unknown) => {
    if (closed) return
    log(
      `staged plugins watch failed, polling the marker instead: ${error instanceof Error ? error.message : String(error)}`,
    )
    check()
    if (!stopPolling) stopPolling = every(check, pollMs)
  }

  // FSEvents reports REAL paths; the marker's parent is compared against both spellings.
  let realRoot = root
  try {
    realRoot = realpathSync(root)
  } catch {
    /* a missing root fails the subscription, which degrades to the poll */
  }
  const subscription = subscribe(
    realRoot,
    (events) => {
      const touched = events.some((event) => {
        const parent = dirname(event.path)
        return (parent === realRoot || parent === root) && isMarkerName(basename(event.path))
      })
      if (!touched) return
      if (timer) clearTimeout(timer)
      timer = setTimer(() => {
        timer = null
        check()
      }, debounceMs)
    },
    { ignore: [NESTED_ENTRY], onError: degrade },
  )
  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      stopPolling?.()
      subscription.close()
    },
  }
}
