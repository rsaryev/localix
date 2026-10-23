/**
 * WHICH SESSIONS A PLUGIN MONITOR'S LINES WAKE — only the ones it was armed for.
 *
 * The defect this exists to stop: a manifest monitor runs once for the process, and every line it
 * printed used to wake EVERY root chat of the user ("MVP session targeting"). Nothing named the
 * conversation a watcher was for, so the host guessed "all of them", and a CI watcher's line
 * started a turn in every unrelated chat. A line now goes only to the sessions an explicit arm
 * named; with none, it goes nowhere, and the host says so once per silent stretch instead of once
 * per line (a monitor may print twenty lines a second).
 *
 * Keyed `<plugin>:<monitor>`, the same key the host runs a monitor under. In memory: an arm lasts
 * the process, exactly as the monitor it points does.
 */

export interface MonitorArms {
  arm(key: string, sessionId: string): void
  disarm(key: string, sessionId: string): void
  /** A session that can no longer take a wake (deleted, not a chat) leaves every monitor. */
  disarmSession(sessionId: string): void
  sessionsFor(key: string): readonly string[]
  /**
   * True the FIRST time a line of `key` finds no session since it last had one, so the caller
   * reports the silence once rather than per line.
   */
  firstUnaddressed(key: string): boolean
}

export function createMonitorArms(): MonitorArms {
  const sessions = new Map<string, Set<string>>()
  const reported = new Set<string>()

  return {
    arm(key, sessionId) {
      const set = sessions.get(key) ?? new Set<string>()
      set.add(sessionId)
      sessions.set(key, set)
      reported.delete(key)
    },
    disarm(key, sessionId) {
      const set = sessions.get(key)
      if (!set?.delete(sessionId)) return
      if (set.size === 0) sessions.delete(key)
      reported.delete(key)
    },
    disarmSession(sessionId) {
      for (const [key, set] of sessions) {
        if (!set.delete(sessionId)) continue
        if (set.size === 0) sessions.delete(key)
        reported.delete(key)
      }
    },
    sessionsFor: (key) => [...(sessions.get(key) ?? [])],
    firstUnaddressed(key) {
      if ((sessions.get(key)?.size ?? 0) > 0 || reported.has(key)) return false
      reported.add(key)
      return true
    },
  }
}
