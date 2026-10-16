import type { CSSProperties } from 'react'

/**
 * The island's fixed scale. The native host (`companion.rs`) mirrors these numbers; change both
 * sides together. The canvas never resizes: only the visible silhouette inside it changes.
 */
export const ISLAND = {
  canvasWidth: 720,
  canvasHeight: 680,
  /** One open size: room for a reply without a separate enlarged mode. */
  openWidth: 580,
  openMinHeight: 64,
  /** First paint before the shell reports content, and the browser preview. */
  openInitialHeight: 144,
} as const

/** What the host measured for the resting cutout. A display without a notch reports zeros. */
export interface IslandGeometry {
  compactWidth: number
  compactHeight: number
  notchWidth: number
  notchHeight: number
  nativeMaterial?: boolean
  nativePanel?: boolean
}

/** The browser preview and non-macOS shells: a small target strip at the top center. */
export const PREVIEW_GEOMETRY: IslandGeometry = {
  compactWidth: 48,
  compactHeight: 36,
  notchWidth: 0,
  notchHeight: 0,
}

export function isIslandGeometry(value: unknown): value is IslandGeometry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['compactWidth', 'compactHeight', 'notchWidth', 'notchHeight'].every(
    (key) => typeof record[key] === 'number' && Number.isFinite(record[key]),
  )
}

/** Content height plus the notch band, clamped to what the canvas can show. */
export function clampOpenHeight(contentHeight: number, notchHeight: number): number {
  return Math.min(
    ISLAND.canvasHeight,
    Math.max(ISLAND.openMinHeight, Math.ceil(contentHeight + notchHeight)),
  )
}

/** CSS reads every number from here; island.css holds no geometry literals. */
export function islandStyle(geometry: IslandGeometry, openHeight: number): CSSProperties {
  return {
    '--island-canvas-width': `${ISLAND.canvasWidth}px`,
    '--island-canvas-height': `${ISLAND.canvasHeight}px`,
    '--island-open-width': `${ISLAND.openWidth}px`,
    '--island-open-height': `${openHeight}px`,
    '--island-compact-width': `${geometry.compactWidth}px`,
    '--island-compact-height': `${geometry.compactHeight}px`,
    '--island-notch-width': `${geometry.notchWidth}px`,
    '--island-notch-height': `${geometry.notchHeight}px`,
  } as CSSProperties
}
