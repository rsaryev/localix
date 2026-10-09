import type { DiagnosticsListener } from './lsp-client-contract'

/** File-specific push waits; clearing listeners preserves their existing timeout deadlines. */
export function createPushWait() {
  const diagnosticsListeners = new Set<DiagnosticsListener>()

  function notifyDiagnosticsListeners(filePath: string) {
    for (const l of diagnosticsListeners) l(filePath)
  }

  /** Wait up to `timeout` ms for a diagnostics push for `filePath` */
  function waitForPush(filePath: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        diagnosticsListeners.delete(listener)
        resolve(false)
      }, timeout)
      const listener: DiagnosticsListener = (fp) => {
        if (fp === filePath) {
          clearTimeout(timer)
          diagnosticsListeners.delete(listener)
          resolve(true)
        }
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
