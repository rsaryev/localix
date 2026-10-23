import { useSyncExternalStore } from 'react'
import {
  miniAppContribSnapshot,
  miniAppContribVersion,
  subscribeMiniAppContrib,
} from '@/shared/contrib/enabledMiniApps'
import { miniAppIconGlyph } from '@/entities/mini-app-store/ui/miniAppIconGlyph'

/**
 * A mini app's rail button wears the icon its manifest names, when it names one; otherwise the
 * glyph its screen registered. Read from the installed mini apps the workbench holds.
 */
export function railIcon(miniApp: string | undefined) {
  const icon = miniApp
    ? miniAppContribSnapshot().miniApps.find((app) => app.name === miniApp)?.icon
    : undefined
  return icon ? miniAppIconGlyph(icon) : undefined
}

/** Moves whenever the installed mini apps (and so their icons) are read again. */
export function useRailIconsVersion(): number {
  return useSyncExternalStore(subscribeMiniAppContrib, miniAppContribVersion)
}
