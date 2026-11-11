/**
 * The system's Reduce transparency, as `data-reduce-transparency` on `<html>`.
 *
 * The kit's opaque fallbacks key off that attribute, not off `prefers-reduced-transparency`,
 * because WKWebView never matches the media query: on macOS the shell reads the setting from AppKit
 * and stamps the attribute itself (`display_options.rs`). Everywhere else the engine's own query is
 * mirrored here, so the attribute has exactly one producer per platform.
 */

export const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)'

interface ReducedTransparencyQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
}

export function mirrorReducedTransparency(
  query: ReducedTransparencyQuery,
  root: HTMLElement,
): void {
  const stamp = (matches: boolean) => {
    if (matches) root.dataset.reduceTransparency = 'true'
    else delete root.dataset.reduceTransparency
  }
  if (query.matches) stamp(true)
  query.addEventListener('change', (event) => stamp(event.matches))
}

/** Whether the host page is stamped: the one fact a frame the host builds is told. */
export function hostReducesTransparency(): boolean {
  return document.documentElement.dataset.reduceTransparency === 'true'
}

/**
 * The attributes of a host-built frame's `<html>`: its theme, and the stamp when the host has it.
 * A frame is its own document, so the host's stamp does not reach it, and its own media query is as
 * dead as the host's in WKWebView.
 */
export function frameRootAttributes(theme: 'light' | 'dark', reduceTransparency: boolean): string {
  return reduceTransparency
    ? `data-theme="${theme}" data-reduce-transparency="true"`
    : `data-theme="${theme}"`
}
