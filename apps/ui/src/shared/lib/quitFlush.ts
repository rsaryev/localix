/**
 * The one list of writes that must land before the page goes away.
 *
 * THE DEFECT. Several stores keep their newest state in a debounced write — the editor grid,
 * a caret/scroll position, a settings PATCH, a half-typed message. Quitting the desktop app,
 * or a reload (the port handoff on every cold start, a runtime respawn), ended the page with
 * those timers still pending, so the next launch restored an older state than the one the
 * person left, and a settings edit came back reverted.
 *
 * THE SHAPE. Each owner registers the function that performs its pending write NOW. Two
 * triggers run the list:
 * - the shell's `localix://before-quit` (`apps/desktop-tauri/src-tauri/src/quit.rs`): every
 *   flush is awaited, bounded by {@link QUIT_FLUSH_BUDGET_MS}, and the page answers
 *   `quit_ready` so the shell stops the runtime only after the settings PATCH went out;
 * - `pagehide` / `visibilitychange: hidden`, the browser's own last chance, where nothing can
 *   be awaited: the synchronous half of each flush (a localStorage write) still lands.
 *
 * Kept dependency-light and cheap to import: it sits on the startup path.
 */
import { tauriInvoke, tauriListen } from './tauri'

export const BEFORE_QUIT_EVENT = 'localix://before-quit'

/** Shorter than the shell's own 1.5 s ceiling, so the page always answers first. */
export const QUIT_FLUSH_BUDGET_MS = 1_200

type Flush = () => unknown

const flushes = new Map<string, Flush>()

/**
 * Register a pending-write flush under a name unique to its owner; a second registration under
 * the same name REPLACES the first (a re-evaluated module must not leave its stale twin behind).
 * Returns the unregister, which removes only this registration.
 */
export function registerQuitFlush(name: string, flush: Flush): () => void {
  flushes.set(name, flush)
  return () => {
    if (flushes.get(name) === flush) flushes.delete(name)
  }
}

export interface PendingWrite {
  /** (Re)arm the debounce. */
  readonly schedule: () => void
  /** Perform a pending write now; a no-op when nothing is pending. */
  readonly flush: () => void
  /** Flush, then leave the quit list — for an owner that is going away (an editor closing). */
  readonly dispose: () => void
}

/**
 * A debounced write that is FLUSHED, never dropped: on quit and pagehide through the list
 * above, and on `dispose`. The shape every debounced owner here shares, so none of them can
 * again clear its timer on the way out and lose the last write.
 */
export function createPendingWrite(name: string, delayMs: number, write: () => void): PendingWrite {
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    timer = undefined
    write()
  }
  const flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    fire()
  }
  const unregister = registerQuitFlush(name, flush)
  return {
    schedule: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(fire, delayMs)
    },
    flush,
    dispose: () => {
      flush()
      unregister()
    },
  }
}

/** Start every flush; one that throws never stops the others. */
function startAll(): Array<{ name: string; done: Promise<unknown> }> {
  return [...flushes].map(([name, flush]) => {
    try {
      return { name, done: Promise.resolve(flush()) }
    } catch (error) {
      return { name, done: Promise.reject(error) }
    }
  })
}

/**
 * Run every flush and wait for them, bounded. Resolves with the names that did not finish in
 * time or failed, so a stuck owner is named in the shell log rather than guessed at.
 */
export async function flushAllBeforeQuit(budgetMs = QUIT_FLUSH_BUDGET_MS): Promise<string[]> {
  const started = startAll()
  const settled = new Set<string>()
  const all = Promise.all(
    started.map(({ name, done }) =>
      done.then(
        () => void settled.add(name),
        (error: unknown) => console.warn(`[quit-flush] ${name} failed`, error),
      ),
    ),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs)
  })
  await Promise.race([all, timeout])
  clearTimeout(timer)
  return started.map(({ name }) => name).filter((name) => !settled.has(name))
}

/** Fire every flush without waiting — for page-lifecycle events that cannot await. */
export function flushAllNow(): void {
  for (const { done } of startAll()) done.catch(() => undefined)
}

/**
 * Wire both triggers once, at startup. Returns an uninstall for tests.
 */
export function installQuitFlush(): () => void {
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flushAllNow()
  }
  window.addEventListener('pagehide', flushAllNow)
  document.addEventListener('visibilitychange', onHidden)
  let unlisten: (() => void) | undefined
  let disposed = false
  void tauriListen()?.(BEFORE_QUIT_EVENT, () => {
    void flushAllBeforeQuit().then((unfinished) => {
      if (unfinished.length > 0) console.warn('[quit-flush] unfinished', unfinished)
      void tauriInvoke()?.('quit_ready').catch(() => undefined)
    })
  }).then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  })
  return () => {
    disposed = true
    unlisten?.()
    window.removeEventListener('pagehide', flushAllNow)
    document.removeEventListener('visibilitychange', onHidden)
  }
}
