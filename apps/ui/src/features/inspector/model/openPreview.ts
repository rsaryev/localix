import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { revealPreview } from './revealPreview'

/**
 * Open a preview from a click, and SAY SO when the server refuses.
 *
 * Every button that opened a preview did `void backendClient.openPreview(...)`, and the server's
 * refusal — no such file, a path outside the workspace, nothing serving that URL — went to the
 * console as an unhandled rejection while the button appeared to do nothing. One helper so the
 * three buttons cannot drift back to silence.
 *
 * Reveals from the response rather than waiting for the `preview.updated` stream frame: that frame
 * only reaches a client with a mounted, watching chat surface for the session, so a click made from
 * a file tab or a plugin view while the chat tab was elsewhere would otherwise record the preview and
 * show it to nobody.
 */
export function openPreviewFromClick(sessionId: string, url: string): void {
  void backendClient
    .openPreview(sessionId, url)
    .then((opened) => revealPreview(sessionId, opened))
    .catch((error: unknown) => {
      toast.error('Could not open the preview', {
        description: errorMessage(error, '') || undefined,
      })
    })
}
