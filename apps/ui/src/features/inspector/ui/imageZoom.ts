/**
 * Pure zoom math for the inspector image viewer.
 * No DOM — just the scale ladder and step/clamp/label helpers, so it can be
 * unit-tested in isolation and reused by the view + any keyboard command.
 */

/** `'fit'` = scale-to-pane; a number = an explicit multiple of natural pixels. */
export type ImageScale = number | 'fit'

/** Hard clamp bounds for free (wheel/pinch) zooming. */
export const MIN_SCALE = 0.1
export const MAX_SCALE = 20

/** Enable nearest-neighbour rendering once magnified past this multiple. */
export const PIXELATION_THRESHOLD = 3

/** Discrete stops the +/- buttons and click-to-zoom snap through. */
export const ZOOM_LEVELS: readonly number[] = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5, 2, 3, 5, 7, 10, 15, 20,
]

export function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE)
}

/** Next discrete stop strictly above `scale` (capped at MAX_SCALE). */
export function nextZoomIn(scale: number): number {
  for (const level of ZOOM_LEVELS) {
    if (level > scale) return level
  }
  return MAX_SCALE
}

/** Next discrete stop strictly below `scale` (floored at MIN_SCALE). */
export function nextZoomOut(scale: number): number {
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < scale) return ZOOM_LEVELS[i]
  }
  return MIN_SCALE
}

/** Human label for the zoom control ("Fit" or a rounded percentage). */
export function zoomLabel(scale: ImageScale): string {
  return scale === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`
}
