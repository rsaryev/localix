// Native-app chrome: suppress the browser's default right-click menu (Back /
// Reload / Save As / Inspect) in the desktop shell — that menu is a dead giveaway
// the surface is a web page. We KEEP the native menu where it's genuinely useful:
// over editable fields (copy/paste/spellcheck) and over a live text selection
// (copy). Everywhere else on the app chrome, right-click does nothing, like a
// native app without its own custom menus. Pure predicate + a thin installer so
// the interesting decision is unit-tested.

/**
 * Should the browser's native context menu be allowed for a right-click on
 * `target`, given whether there's an active text selection? True over editable
 * fields or a non-empty selection (native copy/paste is wanted); false over inert
 * chrome (suppress the web-page menu).
 */
export function shouldAllowNativeContextMenu(
  target: Element | null,
  hasSelection: boolean,
): boolean {
  if (hasSelection) return true
  if (!target) return false
  return target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') != null
}

/**
 * Install the desktop context-menu suppressor. No-op in a plain browser (only the
 * packaged app should feel native). Returns a cleanup fn. `isDesktop` is passed in
 * to keep this module free of the desktop-detection import for testing.
 */
export function installNativeContextMenu(isDesktop: boolean): () => void {
  if (!isDesktop || typeof document === 'undefined') return () => {}
  const handler = (e: MouseEvent) => {
    const hasSelection = (window.getSelection?.()?.toString().length ?? 0) > 0
    if (shouldAllowNativeContextMenu(e.target as Element | null, hasSelection)) return
    e.preventDefault()
  }
  document.addEventListener('contextmenu', handler)
  return () => document.removeEventListener('contextmenu', handler)
}
