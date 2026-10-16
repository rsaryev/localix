// Desktop window-chrome state stamped onto <html> so CSS can mirror native
// macOS titlebar behavior without JS in every component (sibling of
// `applyPlatformDataset()`'s data-os / data-desktop stamps):
//
// - `data-window-inactive="true"` while the OS window is unfocused — the custom
//   titlebar dims like a native inactive titlebar.
// - `data-fullscreen="true"` in native fullscreen — the traffic lights
//   auto-hide there, so the titlebar drops its reserved left padding.
//
// Installed once from main.tsx; no-op outside the desktop shell.

import { isDesktop } from '@localixai/kit/environment'
import { tauriCurrentWindow, tauriListen } from './tauri'

/** Install window focus/blur + fullscreen tracking. Call once at startup. */
export function installWindowChromeState(): void {
  if (!isDesktop || typeof window === 'undefined' || typeof document === 'undefined') return
  const root = document.documentElement

  // ── Inactive-window dimming ────────────────────────────────────────────────
  // Focus moving INTO an embedded iframe (preview, plugin panel) fires
  // a top-window 'blur' while the OS window is still focused — defer and check
  // document.hasFocus() (true when any frame in the window has focus) so we
  // only dim on a real OS-level focus loss.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.hasFocus()) root.dataset.windowInactive = 'true'
    }, 0)
  })
  window.addEventListener('focus', () => {
    delete root.dataset.windowInactive
  })

  // ── Native-fullscreen stamp ────────────────────────────────────────────────
  // OS-level fullscreen (green traffic light), NOT the web Fullscreen API.
  const stampFullscreen = () => {
    tauriCurrentWindow()
      ?.isFullscreen()
      .then((fs) => {
        root.dataset.fullscreen = String(fs)
      })
      .catch(() => {})
  }
  stampFullscreen()
  tauriListen()?.('tauri://resize', stampFullscreen).catch(() => {})
}
