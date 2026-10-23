import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'

// Trigger a download of in-memory text (CSV/JSON/SQL exports). Thin wrapper over the
// shared desktop-aware save path: WKWebView (the Tauri desktop shell) ignores the
// `download` attribute on blob: URLs, so a bare synthetic-anchor download would
// silently do nothing there — route through the native save dialog first and fall
// back to the normal web download in the browser.
export function downloadTextFile(filename: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` })
  void miniAppFiles.saveBlob(filename, blob)
}
