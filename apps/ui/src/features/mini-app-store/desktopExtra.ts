import { useMemo } from 'react'
import { MonitorDown } from 'lucide-react'
import { componentCount, type Listing } from '@localixai/store'
import { useMiniAppDesktopApps, type MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'

const isMiniApp = (listing: Listing) => listing.ref.kind === 'mini-app'

/**
 * A mini app's desktop app (its own Mac app), as the Store offers it beside Install: available for
 * a mini app with a screen of its own where the shell makes desktop apps.
 */
export function desktopExtra(
  port: MiniAppDesktopApps,
  installed: readonly string[],
): StoreInstallExtra {
  return {
    id: 'desktop-app',
    label: 'Install as app',
    hint: 'Also adds it as an app with its own window, Dock icon and place in Spotlight',
    icon: MonitorDown,
    makes: 'desktop app',
    available: (listing) =>
      isMiniApp(listing) &&
      port.available(listing.ref.id, componentCount(listing, 'screen') > 0 ? ['workbench'] : []),
    has: (listing) => isMiniApp(listing) && installed.includes(listing.ref.id),
    make: (listing) => port.install(listing.ref.id, listing.displayName),
    remove: (listing) => port.remove(listing.ref.id),
  }
}

/** The extra, from the port the standalone-app feature provides; undefined where there is none. */
export function useDesktopExtra(): StoreInstallExtra | undefined {
  const desktop = useMiniAppDesktopApps()
  const port = desktop?.port
  const installed = desktop?.installed
  return useMemo(
    () => (port && installed ? desktopExtra(port, installed) : undefined),
    [port, installed],
  )
}
