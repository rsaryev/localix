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
import type { MiniAppMonitorArmRequest, MiniAppMonitorsHost } from '@localixai/mini-app-sdk/backend'

import type { PluginMonitorHost } from './monitor-host'

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

/**
 * The `monitors` host service one plugin receives: its own monitors only, for a session the user
 * owns. The ownership check lives here, before the arm, because the monitor host has no session
 * store — and an unchecked id would let a plugin point a watcher at a chat it was never shown.
 */
export function bindPluginMonitors(deps: {
  pluginName: string
  /** Read per call: the monitor host is built after the plugin hosts. */
  host: () => Pick<PluginMonitorHost, 'arm' | 'disarm'> | undefined
  /** The ownership gate: rejects (or resolves null) for a missing, foreign or deleted session. */
  resolveSessionCwd: (userId: string, sessionId: string) => Promise<string | null | undefined>
}): MiniAppMonitorsHost {
  const target = (request: MiniAppMonitorArmRequest) => ({
    userId: request.userId,
    sessionId: request.sessionId,
    pluginName: deps.pluginName,
    monitorName: request.monitor,
  })
  return {
    async arm(request) {
      const host = deps.host()
      if (!host) return { status: 'refused', reason: 'this host runs no plugin monitors' }
      if (!request.sessionId?.trim())
        return { status: 'refused', reason: 'an arm names the session the monitor wakes' }
      const owned = await deps
        .resolveSessionCwd(request.userId, request.sessionId)
        .then(Boolean, () => false)
      if (!owned) return { status: 'refused', reason: 'no such session for this user' }
      return host.arm(target(request))
    },
    disarm: (request) => deps.host()?.disarm(target(request)),
  }
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
