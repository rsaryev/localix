import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { platformCapabilities } from './platformCapabilities'
import { toast } from './notify'

/**
 * Restart the app after the local runtime failed to start.
 *
 * This is the action behind "Restart Localix" on the runtime-error notice — the
 * one control a person has when the workspace never came up, so it is the last
 * place that may quietly do nothing.
 *
 * It used to be `void platformCapabilities().desktop.invoke('restart_app')`.
 * `desktop.invoke` returns `null` — not a rejected promise — whenever the bridge
 * global is absent, and `void null` is a no-op, so on the web build and in any
 * packaged window where the bridge did not attach, clicking the only offered
 * remedy produced no restart, no reload, and no message. The button was
 * indistinguishable from a dead one.
 *
 * Three honest outcomes now:
 * - the shell restarts the process (the native call never returns);
 * - no bridge → reload the document, which is the web-equivalent retry and is
 *   what the button promises;
 * - the shell REFUSED the restart → say so, then still reload, so the person is
 *   never left with a notice whose only action does nothing.
 */
export function restartDesktopApp(): void {
  const invoked = platformCapabilities().desktop.invoke('restart_app')
  if (!invoked) {
    // No native bridge in this window. Reloading is the honest equivalent, and it
    // is what the web build has always been able to do.
    platformCapabilities().navigation.reload()
    return
  }
  invoked.catch((error: unknown) => {
    toast.error('Could not restart the app', {
      description: errorMessage(error, 'The desktop shell refused the restart.'),
    })
    platformCapabilities().navigation.reload()
  })
}
