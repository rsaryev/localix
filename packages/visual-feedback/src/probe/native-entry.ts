/** Native WebView bridge: reuse the same actuator as the embedded local-page probe. */
import type { VfCommand } from '../protocol/index'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from '../actuate/index'

interface NativeBridge {
  run: (id: string, command: VfCommand) => void
  take: (id: string) => unknown
  /** The document began to unload moments ago: a navigation is replacing it. */
  leaving: () => boolean
}

/**
 * How long an unload that started counts as a navigation in flight. Engines other than WebKit on
 * macOS cannot say whether a load the page itself started (a link, a form) is in flight; the
 * document can. A download or a 204 answer unloads nothing, so the signal fades instead of
 * holding commands until the next page.
 */
const LEAVING_MS = 3000

/**
 * Results held for the host to take. A command whose host gave up (a timeout) is never taken;
 * the oldest are dropped past this many, so an open page does not keep them forever.
 */
const MAX_RESULTS = 64

declare global {
  interface Window {
    __localixBrowser?: NativeBridge
  }
}

if (!window.__localixBrowser) {
  const deps: ActuateDeps = {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
  }
  const results = new Map<string, unknown>()
  let leftAt = Number.NEGATIVE_INFINITY
  // Passive: it never asks the person to confirm leaving.
  window.addEventListener('beforeunload', () => {
    leftAt = Date.now()
  })
  window.__localixBrowser = {
    run(id, command) {
      if (results.has(id)) return
      results.set(id, null)
      while (results.size > MAX_RESULTS) results.delete(results.keys().next().value as string)
      void runCommand(command, deps).then(
        (result) => results.set(id, result),
        (error) =>
          results.set(id, {
            ok: false,
            errorCode: 'failed',
            error: error instanceof Error ? error.message : String(error),
          }),
      )
    },
    leaving: () => Date.now() - leftAt < LEAVING_MS,
    take(id) {
      const result = results.get(id)
      if (result !== null && result !== undefined) results.delete(id)
      return result
    },
  }
}
