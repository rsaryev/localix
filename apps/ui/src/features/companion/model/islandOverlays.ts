import { tauriInvoke } from '@/shared/lib/tauri'

/** This WebView owns only the island; shared composer pickers portal into its document. */
export const ISLAND_OVERLAY_SELECTOR =
  '[data-island-overlay], [role="menu"], [role="listbox"], [role="dialog"], [data-slot="popover-content"]'

export function setIslandGrab(grab: boolean) {
  void tauriInvoke()?.('companion_set_grab', { grab }).catch(() => {})
}
