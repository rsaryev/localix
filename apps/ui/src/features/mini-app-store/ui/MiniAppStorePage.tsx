import { useMemo } from 'react'
import type { StoreDesktopApps } from '@/entities/mini-app-store/model/storeActions'
import { MiniAppStore } from '@/entities/mini-app-store/ui/MiniAppStore'
import { useMiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'

/** The store's desktop apps, from the port the standalone-app feature provides at start-up. */
function useStoreDesktopApps(): StoreDesktopApps | undefined {
  const desktop = useMiniAppDesktopApps()
  const port = desktop?.port
  const installed = desktop?.installed
  return useMemo(() => {
    if (!port || !installed) return undefined
    return {
      available: (entry) => port.available(entry.name, entry.surfaces),
      has: (name) => installed.includes(name),
      install: (name, title) => port.install(name, title),
      remove: (name) => port.remove(name),
    }
  }, [port, installed])
}

/**
 * The store's tab: a short heading, then the store filling the pane. A `localix://` link to add a
 * catalog arrives as the tab's payload and opens the add dialog with its address.
 */
export function MiniAppStorePage({ addCatalogUrl }: { addCatalogUrl?: string }) {
  const desktop = useStoreDesktopApps()
  return (
    <div className="@container h-full min-h-0 overflow-y-auto px-4 py-5 @2xl:px-6">
      <header className="mb-3 px-2">
        <h1 className="text-base font-semibold text-foreground">Mini apps</h1>
        <p className="text-xs text-text-soft">
          Screens and tools that work beside your chats. One you install appears in the rail.
        </p>
      </header>
      <MiniAppStore desktop={desktop} addCatalogUrl={addCatalogUrl} />
    </div>
  )
}
