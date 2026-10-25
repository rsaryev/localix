import { createContext, useContext } from 'react'

/**
 * HOW THE STORE ADAPTS (`docs/internals/store.md`, "Adaptive layout"): by the Store pane's own
 * width, never the window's — the same window gives the Store a different width beside a chat.
 *
 * | Pane         | Sidebar      | Rows            | Lists     | Package page          |
 * | ≥ 1100px     | full         | 4–5 tiles       | 2–3 cols  | facts beside          |
 * | 760–1100px   | icons only   | 3 tiles         | 2 cols    | facts under the header |
 * | < 760px      | section menu | scroll with snap | 1 col    | one column, Get pinned |
 */
export type StoreLayout = 'wide' | 'medium' | 'narrow'

export const WIDE_PX = 1100
export const MEDIUM_PX = 760

/** The layout for a pane `width` px wide; before the first measurement, the wide one. */
export function layoutFor(width: number | null): StoreLayout {
  if (width === null || width >= WIDE_PX) return 'wide'
  return width >= MEDIUM_PX ? 'medium' : 'narrow'
}

/** How many tiles a row shows at once; a fraction lets the next one peek in. */
export function tilesPerView(layout: StoreLayout, width: number | null): number {
  if (layout === 'narrow') return (width ?? 0) < 480 ? 1.25 : 2.25
  if (layout === 'medium') return 3
  return (width ?? WIDE_PX) >= 1360 ? 5 : 4
}

/** How many columns a list of rows takes. */
export function listColumns(layout: StoreLayout, width: number | null): number {
  if (layout === 'narrow') return 1
  if (layout === 'medium') return 2
  return (width ?? WIDE_PX) >= 1500 ? 3 : 2
}

export interface StoreFrame {
  layout: StoreLayout
  /** The pane's width in px, or null before it is measured. */
  width: number | null
}

export const StoreFrameContext = createContext<StoreFrame>({ layout: 'wide', width: null })

export const useStoreFrame = () => useContext(StoreFrameContext)
