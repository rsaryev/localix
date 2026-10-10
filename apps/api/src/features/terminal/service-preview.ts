import type { TerminalSession } from './session'
import type { TerminalServiceDeps } from './service-deps'
import { scanListeningPorts, isSameOrDescendant } from './port-scan'
import { createPortScanCache } from './port-scan-cache'

/** How long a single OS port scan is reused before re-running — bounds `lsof`//proc/
 *  cost to ~once per this window no matter how often the UI polls the job list. */
const PORT_SCAN_TTL_MS = 2_500

export function createTerminalPreview(
  sessions: Map<string, TerminalSession>,
  deps: Pick<
    TerminalServiceDeps,
    'scanListeningPorts' | 'portScanTtlMs' | 'reportEndpointLiveness'
  >,
) {
  // Sessions whose previewUrl was filled from the OS PORT SCAN (no banner) →
  // {port,pid} we attributed. Tracked so we evict ONLY scan-derived URLs when the
  // listener dies; a banner URL (the server's own claim) is never auto-evicted.
  const scanState = new Map<string, { port: number; pid: number }>()
  // Shared, throttled, single-flight scan — one enumeration per TTL across all callers/tabs.
  const portScan = createPortScanCache(
    deps.scanListeningPorts ?? scanListeningPorts,
    deps.portScanTtlMs ?? PORT_SCAN_TTL_MS,
  )

  return {
    /**
     * Cross-validate command-bearing jobs against the OS's real listening ports
     * (throttled scan). For a job that printed NO banner this fills `previewUrl`
     * from a listener whose process runs inside the session's workspace (cwd
     * same-or-descendant) — so "Open preview" works without any stdout URL. A
     * scan-derived URL is evicted when its listener disappears; banner URLs are
     * left untouched. Best-effort: a failed/empty scan is a no-op. Call before
     * `list()` when the UI needs fresh job preview state.
     */
    async ensurePreviewUrls(userId: string): Promise<void> {
      const owned = [...sessions.values()].filter((s) => s.userId === userId && s.command)
      // Drop scan-state for sessions that are gone.
      for (const id of scanState.keys()) if (!sessions.has(id)) scanState.delete(id)
      if (owned.length === 0) return

      const ports = await portScan.get()

      for (const session of owned) {
        const matches = ports.filter((p) => p.cwd && isSameOrDescendant(p.cwd, session.cwd))
        const tracked = scanState.get(session.id)
        if (matches.length > 0) {
          // Lowest port is the deterministic pick when several listen in the same
          // workspace (a dev server + its HMR socket); a banner, when present,
          // already set a precise URL and we don't override it.
          const chosen = matches.reduce((a, b) => (b.port < a.port ? b : a))
          const hasUrl = session.info.previewUrl !== undefined
          if (!hasUrl) {
            session.setPreviewUrl(`http://localhost:${chosen.port}`)
            scanState.set(session.id, { port: chosen.port, pid: chosen.pid })
          } else if (tracked && !matches.some((m) => m.port === tracked.port)) {
            // Our scan-derived port vanished but another is live → re-point.
            session.setPreviewUrl(`http://localhost:${chosen.port}`)
            scanState.set(session.id, { port: chosen.port, pid: chosen.pid })
          }
        } else if (tracked) {
          // The scan-derived listener is gone → forget it (the button disappears), and say
          // so: a server that stopped without its shell exiting has no other event.
          const gone = session.info.previewUrl
          session.clearPreviewUrl()
          scanState.delete(session.id)
          if (gone) deps.reportEndpointLiveness?.(gone, false)
        }
      }
    },
  }
}
