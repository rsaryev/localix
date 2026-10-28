import type { DiagnosticsListener } from './lsp-client-contract'

/**
 * How long the server stays silent after publishing for other files before a waiting file counts
 * as checked. vtsls publishes only diagnostics that changed: of several clean files written
 * together one gets a push and the rest none, so waiting for each file's own push spent the whole
 * deadline on every multi-file write. Measured on a mini app with vtsls: five files written at once
 * took 6.0s, and 1.8s with this window. A file's own errors can come about half a second after
 * another file's push (the semantic check runs file by file), so the window is wider than that.
 */
export const DIAGNOSTICS_QUIET_MS = 1_000

/**
 * File-specific push waits; clearing listeners preserves their existing timeout deadlines. A wait
 * settles on its file's push, or once the server has published for another file and then gone
 * quiet for `quietMs` — its check round is over, with nothing new to say about this one.
 */
export function createPushWait(options: { quietMs?: number } = {}) {
  const quietMs = options.quietMs ?? DIAGNOSTICS_QUIET_MS
  const diagnosticsListeners = new Set<DiagnosticsListener>()

  function notifyDiagnosticsListeners(filePath: string) {
    for (const l of diagnosticsListeners) l(filePath)
  }

  /** Wait up to `timeout` ms for a diagnostics push for `filePath`, or for the server to go quiet. */
  function waitForPush(filePath: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | undefined
      const settle = (answered: boolean) => {
        clearTimeout(timer)
        clearTimeout(quiet)
        diagnosticsListeners.delete(listener)
        resolve(answered)
      }
      const timer = setTimeout(() => settle(false), timeout)
      const listener: DiagnosticsListener = (fp) => {
        if (fp === filePath) return settle(true)
        clearTimeout(quiet)
        quiet = setTimeout(() => settle(true), quietMs)
      }
      diagnosticsListeners.add(listener)
    })
  }

  return {
    notifyDiagnosticsListeners,
    waitForPush,
    clearListeners: () => diagnosticsListeners.clear(),
  }
}
