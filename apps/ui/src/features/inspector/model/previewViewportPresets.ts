/**
 * Viewport presets for the preview's responsive check — pure data + helpers, no
 * React, no DOM (mirrors `previewPortPresets.ts`, which is the "which server" axis;
 * this is the "which screen" axis).
 *
 * SCOPE — deliberately the LAYOUT viewport only. Our preview is an `<iframe>`, not a
 * CDP-driven webview, so we can size the frame (which is what CSS media queries and
 * container queries actually respond to) but we can NOT emulate device-pixel-ratio,
 * a mobile user-agent string, or touch input. The UI says so rather than implying
 * full device emulation. Widths/heights are the real CSS viewports of the named
 * devices, so breakpoint behaviour is faithful even though the UA is not.
 */

export interface PreviewViewportPreset {
  /** Row label in the menu, also the toolbar chip when active. */
  label: string
  /** CSS viewport width in px, or null for "fill the panel". */
  width: number | null
  /** CSS viewport height in px, or null for "fill the panel". */
  height: number | null
  /** Muted secondary hint — what this size stands for. */
  hint?: string
}

/** The default: the frame fills whatever space the panel gives it. */
export const PREVIEW_VIEWPORT_FILL: PreviewViewportPreset = {
  label: 'Responsive',
  width: null,
  height: null,
  hint: 'fills the panel',
}

/**
 * Ordered small → large. The mobile/tablet sizes match the CSS viewports of the
 * named devices; the laptop/desktop rows cover the
 * breakpoints above them that a device list alone leaves untested.
 */
export const PREVIEW_VIEWPORT_PRESETS: readonly PreviewViewportPreset[] = [
  PREVIEW_VIEWPORT_FILL,
  { label: 'iPhone SE', width: 375, height: 667, hint: 'small phone' },
  { label: 'iPhone 15 Pro', width: 393, height: 852, hint: 'modern phone' },
  { label: 'Pixel 8', width: 412, height: 915, hint: 'large phone' },
  { label: 'iPad Mini', width: 768, height: 1024, hint: 'tablet' },
  { label: 'Laptop', width: 1280, height: 800, hint: 'small desktop' },
  { label: 'Desktop', width: 1440, height: 900, hint: 'wide desktop' },
]

/** True when the preset pins a size (i.e. is not the fill default). */
export function isFixedViewport(p: PreviewViewportPreset): boolean {
  return p.width !== null && p.height !== null
}

/** Swap width/height. A no-op on the fill preset, which has no axes to swap. */
export function rotateViewport(p: PreviewViewportPreset): PreviewViewportPreset {
  if (!isFixedViewport(p)) return p
  return { ...p, width: p.height, height: p.width }
}

/** `393 × 852` for a fixed preset, or null when the frame just fills the panel. */
export function viewportSizeLabel(p: PreviewViewportPreset): string | null {
  return isFixedViewport(p) ? `${p.width} × ${p.height}` : null
}
