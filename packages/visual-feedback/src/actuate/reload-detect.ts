/**
 * Reload detection for agent control. A dev-server file-watch auto-reload (or a
 * `location.reload()`) navigates the previewed page: the probe re-mounts in a FRESH
 * realm, so its ref registry / DOM state are reset. Nothing in a fresh realm knows
 * the previous page had agent activity — UNLESS we persist a flag somewhere that
 * survives a same-origin reload. `sessionStorage` does exactly that.
 *
 * The tracker flags the FIRST agent command of a probe instance when a PRIOR instance
 * had already run a command (i.e. this load follows a reload that happened between
 * the agent's commands). The tool turns that into an explicit "page reloaded — DOM
 * reset, refs invalid" notice so the model doesn't misread the reset as a broken
 * control. Pure + storage-injected so it is unit-testable.
 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface ReloadTracker {
  /** Call once per agent command. Returns true exactly when THIS command is the first
   *  of a fresh page load that followed prior agent activity (a mid-session reload). */
  consume(): boolean
}

const RELOAD_ACTIVITY_KEY = '__vf_agent_activity'

export function createReloadTracker(
  storage: StorageLike | null,
  key = RELOAD_ACTIVITY_KEY,
): ReloadTracker {
  let priorActivity = false
  try {
    priorActivity = storage?.getItem(key) === '1'
  } catch {
    /* storage blocked/partitioned */
  }
  let first = true
  return {
    consume() {
      if (!first) return false
      first = false
      try {
        storage?.setItem(key, '1')
      } catch {
        /* storage blocked/partitioned */
      }
      return priorActivity
    },
  }
}

/** The page's own sessionStorage, or null when it is unavailable (blocked/partitioned). */
export function safeSessionStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}
