import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { isDesktop } from '@localixai/kit/environment'
import { toast } from './notify'
import { tauriInvoke } from './tauri'

/** Base64-encode bytes in chunks (avoids call-stack limits on large buffers). */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Save a Blob via a synthetic `<a download>` — the browser path, and the safety
 *  net if the native save command is unavailable. */
export function webDownloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Save a Blob through the desktop shell's NATIVE save dialog when running under
 * Tauri, returning true so the caller skips the web `<a download>` fallback.
 *
 * Why: WKWebView (macOS) doesn't honor the `download` attribute on blob: URLs,
 * so the synthetic-anchor download silently fails in the desktop shell. Routing
 * through the Rust `save_file` command (native save dialog + write) fixes exports
 * on every platform and lets the user choose the destination — native behavior.
 *
 * Returns false in the browser (or if the bridge is unavailable) so the caller
 * performs the normal web download. Fire-and-forget: reads the blob and invokes
 * asynchronously, but reports synchronously that it has taken ownership.
 *
 * `save_file` AWAITS the native dialog and the write, then answers with the saved
 * path, `null` for a user cancel, or a rejection carrying the reason. It used to
 * resolve as soon as the command dispatched — the dialog and the write ran after —
 * so a failed write was unreportable by construction and this comment used to
 * conclude that a rejection could only mean "the command is unavailable". Now a
 * rejection is the real thing, and cancel is a distinct, quiet outcome.
 */
export function saveViaDesktop(filename: string, blob: Blob): boolean {
  const invoke = tauriInvoke()
  if (!isDesktop || !invoke) return false
  void (async () => {
    try {
      const buffer = await blob.arrayBuffer()
      await invoke('save_file', { filename, contents: toBase64(buffer) })
    } catch (error) {
      // The anchor fallback is the WEB path, and this module's own reason for
      // existing is that WKWebView ignores `download` on a blob: URL. So inside
      // the shell it is a long shot, not a safety net: if the native save failed
      // the export may well have gone nowhere, and the previous code let it go
      // nowhere in silence. Try the anchor anyway, but say what happened.
      webDownloadBlob(filename, blob)
      toast.error(`Could not save “${filename}”`, {
        description: errorMessage(error, 'The desktop shell refused the save dialog.'),
      })
    }
  })()
  return true
}
