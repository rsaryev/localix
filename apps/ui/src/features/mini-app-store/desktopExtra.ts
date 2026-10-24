import { useMemo } from 'react'
import { componentCount, type Listing } from '@localixai/store'
import { useMiniAppDesktopApps, type MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import type { StoreAppExtra } from '@/shared/lib/storeAppExtra'

const isMiniApp = (listing: Listing) => listing.ref.kind === 'mini-app'

/**
 * A mini app's desktop app (its own Mac app), as the Store offers it beside Install: available for
 * a mini app with a screen of its own where the shell makes desktop apps.
 */
export function desktopExtra(
  port: MiniAppDesktopApps,
  installed: readonly string[],
): StoreAppExtra {
  return {
    available: (listing) =>
      isMiniApp(listing) &&
      port.available(listing.ref.id, componentCount(listing, 'screen') > 0 ? ['workbench'] : []),
    has: (listing) => isMiniApp(listing) && installed.includes(listing.ref.id),
    make: (listing) => port.install(listing.ref.id, listing.displayName),
    remove: (listing) => port.remove(listing.ref.id),
  }
}

/** The extra, from the port the standalone-app feature provides; undefined where there is none. */
export function useDesktopExtra(): StoreAppExtra | undefined {
  const desktop = useMiniAppDesktopApps()
  const port = desktop?.port
  const installed = desktop?.installed
  return useMemo(
    () => (port && installed ? desktopExtra(port, installed) : undefined),
    [port, installed],
  )
}
