/**
 * Write-race guard for the editor reload path (the reload-confusion
 * class). An external write to an open file (agent patch, formatter, git op)
 * arrives as a coarse fs-change / files-reloaded signal that would trigger a
 * re-read. Two hazards:
 *   1. our OWN save echoes back as an fs-change before React has committed the
 *      new base hash — a naive re-read then races the just-saved state and can
 *      surface a spurious conflict on a buffer the user is still editing;
 *   2. one logical change (a rename touching N files, a burst of writes) fires
 *      many signals for the same path.
 *
 * This coordinator closes both: a PER-EDITOR-OWNER debounce coalesces a burst into
 * one reload, and a settle window holds any reload until the save has committed. The dirty
 * check itself stays in the caller's reconcile (which reads live edit state at
 * apply-time and raises the reconcile banner rather than clobbering); this guard
 * re-checks the settle window at FIRE time, not subscribe time, so a stale closure
 * can't win.
 *
 * A module singleton (`reloadGuard`) is keyed by a collision-safe session+absolute
 * path owner key. Session scope is load-bearing: two sessions can share a physical
 * path, but one editor's save echo must not suppress the other's external-change
 * reconcile. `createReloadGuard` is the testable factory (inject clock + timers).
 */

type TimerHandle = ReturnType<typeof setTimeout>

export interface ReloadGuardDeps {
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  /** Per-path debounce window that coalesces a burst of reload signals (ms). */
  debounceMs?: number
  /** How long after a local save to keep dropping fs echoes for that path (ms). */
  settleMs?: number
}

export interface ReloadGuard {
  /** Mark a Localix-initiated save in flight for `path` (call BEFORE the write).
   *  Opens a settle window; fs echoes for `path` are dropped until it closes. */
  markSaving(path: string): void
  /** Whether a recent local save for `path` is still settling (drop-the-echo). */
  isSettling(path: string): boolean
  /** Debounce a reload for `path`. `run` fires once after the debounce window; if the
   *  path is settling at fire time it is held until the settle window closes. A newer
   *  call within the window supersedes the pending one. */
  scheduleReload(path: string, run: () => void): void
  /** Cancel a pending debounce for `path` (e.g. the tab unmounts). */
  cancel(path: string): void
  /** Drop all pending timers + settle windows (test teardown). */
  reset(): void
}

export const DEFAULT_RELOAD_DEBOUNCE_MS = 250
export const DEFAULT_SAVE_SETTLE_MS = 500

export function createReloadGuard(deps: ReloadGuardDeps = {}): ReloadGuard {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h))
  const debounceMs = deps.debounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS
  const settleMs = deps.settleMs ?? DEFAULT_SAVE_SETTLE_MS

  // path → timestamp until which a local save is still settling.
  const savingUntil = new Map<string, number>()
  // path → pending debounce timer + its cleanup timer.
  const debounceTimers = new Map<string, TimerHandle>()
  const settleTimers = new Map<string, TimerHandle>()

  const isSettling = (path: string): boolean => now() < (savingUntil.get(path) ?? 0)

  return {
    markSaving(path) {
      if (!path) return
      savingUntil.set(path, now() + settleMs)
      // Lazy cleanup so the map does not grow unbounded; isSettling stays correct
      // on its own via the expiry timestamp even if this timer is delayed.
      const existing = settleTimers.get(path)
      if (existing !== undefined) clearTimer(existing)
      settleTimers.set(
        path,
        setTimer(() => {
          settleTimers.delete(path)
          if (now() >= (savingUntil.get(path) ?? 0)) savingUntil.delete(path)
        }, settleMs),
      )
    },

    isSettling,

    scheduleReload(path, run) {
      if (!path) return
      const existing = debounceTimers.get(path)
      if (existing !== undefined) clearTimer(existing)
      const arm = (ms: number) =>
        debounceTimers.set(
          path,
          setTimer(() => {
            debounceTimers.delete(path)
            // Re-check the settle window HERE (fire time), so a save that started during
            // the debounce window still holds the echo back. HELD, not dropped: the signal
            // may be a genuine external write (an agent's edit landing just after a save),
            // and dropping it left the tab stale with nothing to retry. Once the save has
            // committed its base hash, the self-save echo reconciles to "unchanged" anyway.
            const wait = (savingUntil.get(path) ?? 0) - now()
            if (wait > 0) arm(wait)
            else run()
          }, ms),
        )
      arm(debounceMs)
    },

    cancel(path) {
      const t = debounceTimers.get(path)
      if (t !== undefined) {
        clearTimer(t)
        debounceTimers.delete(path)
      }
    },

    reset() {
      for (const t of debounceTimers.values()) clearTimer(t)
      for (const t of settleTimers.values()) clearTimer(t)
      debounceTimers.clear()
      settleTimers.clear()
      savingUntil.clear()
    },
  }
}

/** Shared, real-timer guard for every editor tab (keyed by editor owner). */
export const reloadGuard = createReloadGuard()
