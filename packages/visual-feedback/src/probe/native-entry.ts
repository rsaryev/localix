/** Native WebView bridge: reuse the same actuator as the embedded local-page probe. */
import type { VfCommand } from '../protocol/index'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from '../actuate/index'
import { installResourceErrorCapture } from '../actuate/resource-errors'
import { attachFailedResources } from '../actuate/attach-failed-resources'
import { installInflightTracker } from '../actuate/inflight'
import { attachBusy, isPageBusy } from '../actuate/page-busy'
import { installScopedDialogGuard } from '../actuate/dialog-guard'
import { trackLeaving } from './native-leaving'

interface NativeBridge {
  run: (id: string, command: VfCommand) => void
  take: (id: string) => unknown
  /** The document began to unload moments ago: a navigation is replacing it. */
  leaving: () => boolean
}

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
  const leaving = trackLeaving(window, (window as { navigation?: EventTarget }).navigation)
  // A 404'd stylesheet or script leaves a real site silently broken: it is named in the reply.
  const resourceErrors = installResourceErrorCapture()
  const reportedResources = new Set<string>()
  // The page's own requests in flight: a quiet DOM with an answer on the way is still loading.
  const activity = installInflightTracker(window)
  // The page's own dialogs stay the person's; they are cancelled only while a command runs.
  const dialogs = installScopedDialogGuard(deps.console)
  window.__localixBrowser = {
    run(id, command) {
      if (results.has(id)) return
      results.set(id, null)
      while (results.size > MAX_RESULTS) results.delete(results.keys().next().value as string)
      const release = dialogs.hold()
      void runCommand(command, deps)
        .then(
          (r) =>
            results.set(id, {
              ...r,
              result: attachBusy(
                attachFailedResources(r.result, resourceErrors.read(), reportedResources),
                isPageBusy(activity),
              ),
            }),
          (error) =>
            results.set(id, {
              ok: false,
              errorCode: 'failed',
              error: error instanceof Error ? error.message : String(error),
            }),
        )
        .finally(release)
    },
    leaving,
    take(id) {
      const result = results.get(id)
      if (result !== null && result !== undefined) results.delete(id)
      return result
    },
  }
}
