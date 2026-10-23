import { useState } from 'react'
import { BookMarked } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { MiniAppCatalogs } from '@/entities/mini-app-store/ui/MiniAppCatalogs'
import { MiniAppStore } from '@/entities/mini-app-store/ui/MiniAppStore'

/**
 * The store's tab: a short heading with the catalogs it reads one click away, then the store
 * filling the pane.
 */
export function MiniAppStorePage() {
  const [catalogsOpen, setCatalogsOpen] = useState(false)
  return (
    <div className="@container h-full min-h-0 overflow-y-auto px-4 py-5 @2xl:px-6">
      <header className="mb-3 flex items-start gap-3 px-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-foreground">Mini apps</h1>
          <p className="text-xs text-text-soft">
            Screens and tools that work beside your chats. One you install appears in the rail.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={catalogsOpen}
          onClick={() => setCatalogsOpen((open) => !open)}
        >
          <BookMarked data-icon="inline-start" />
          Catalogs
        </Button>
      </header>
      {catalogsOpen && (
        <section aria-label="Catalogs" className="mb-4 rounded-lg border border-border-faint p-2">
          <MiniAppCatalogs />
        </section>
      )}
      <MiniAppStore />
    </div>
  )
}
