/** Native WebView bridge: reuse the same actuator as the embedded local-page probe. */
import type { VfCommand } from '../protocol/index'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from '../actuate/index'

interface NativeBridge {
  run: (id: string, command: VfCommand) => void
  take: (id: string) => unknown
}

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
  window.__localixBrowser = {
    run(id, command) {
      if (results.has(id)) return
      results.set(id, null)
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
    take(id) {
      const result = results.get(id)
      if (result !== null && result !== undefined) results.delete(id)
      return result
    },
  }
}
