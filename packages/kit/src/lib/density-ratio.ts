/** Density scaling helpers. The Settings→font-size control writes the ROOT
 *  font-size (13–16px; 14px default — see settings/model/useFontFamily.ts), so
 *  rem-based UI scales automatically. Surfaces that must size in concrete px
 *  (xterm, the grid's pixel minimums) read the live root size and scale by the
 *  ratio against the 14px baseline. */

export const BASE_ROOT_FONT_PX = 14
/** Monaco and xterm share a readable code measure instead of drifting between 12 and 12.5px. */
export const BASE_CODE_FONT_PX = 13

/**
 * The root size, read from the DOM once and then kept by its one writer.
 *
 * The defect: the editor grid asks for the ratio on every render, and each ask was a
 * `getComputedStyle` of `<html>` — a forced synchronous style recalculation whenever the DOM was
 * dirty, which during startup it always is (41 ms of main thread in the startup profile). The
 * value only moves when the font-size setting is applied, and that code tells us.
 */
let rootFontPx: number | null = null

/** Live root font-size in px. SSR/test-safe: no document → the 14px baseline. */
export function readRootFontPx(): number {
  if (rootFontPx !== null) return rootFontPx
  if (typeof document === 'undefined') return BASE_ROOT_FONT_PX
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  rootFontPx = Number.isFinite(px) && px > 0 ? px : BASE_ROOT_FONT_PX
  return rootFontPx
}

/** Record the root size the font-size setting just applied (its only writer). */
export function setRootFontPx(px: number): void {
  rootFontPx = Number.isFinite(px) && px > 0 ? px : BASE_ROOT_FONT_PX
}

/** Density ratio (root font-size / 14). Exactly 1 at the default setting. */
export function densityRatio(): number {
  return readRootFontPx() / BASE_ROOT_FONT_PX
}

/** Pixel-based code renderers follow the same root preference as rem-based labels. */
export function codeFontSize(): number {
  return BASE_CODE_FONT_PX * densityRatio()
}

/** Test seam: forget the recorded size so the next read measures again. */
export function __resetRootFontPx(): void {
  rootFontPx = null
}
