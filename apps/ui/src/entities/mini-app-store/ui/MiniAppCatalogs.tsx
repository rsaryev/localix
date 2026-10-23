import { useMemo, useState } from 'react'
import { BookMarked, Plus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { appCount, catalogLabel, countBySource } from '../model/storeFilters'
import type { StoreCatalogs } from '../model/storeActions'
import { useMiniAppCatalogs } from '../model/useMiniAppCatalogs'
import { useMiniAppStore } from '../model/useMiniAppStore'
import { AddCatalogDialog } from './AddCatalogDialog'

/**
 * The catalogs the store reads, as Settings lists them: Localix's own first, which always stays,
 * then the ones the person added, each with its app count and removable, and "Add catalog…" —
 * the same dialog the store's catalog menu opens.
 */
export function MiniAppCatalogsView({
  catalogs,
  counts,
}: {
  catalogs: StoreCatalogs
  counts: Record<string, number>
}) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {catalogs.list.map((catalog) => {
          const title = catalogLabel(catalog)
          return (
            <li
              key={catalog.url}
              className="group/catalog flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
            >
              <BookMarked className="size-4 shrink-0 text-text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{title}</p>
                <p className="truncate text-xs text-text-soft" title={catalog.url}>
                  {catalog.builtIn ? 'Comes with Localix' : catalog.url}
                </p>
              </div>
              <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                {appCount(counts[catalog.url] ?? 0)}
              </span>
              {catalog.builtIn ? (
                <span className="w-6 shrink-0" />
              ) : (
                <IconButton
                  size="sm"
                  aria-label={`Remove ${title}`}
                  className="opacity-0 group-hover/catalog:opacity-100 focus-visible:opacity-100"
                  onClick={() => void catalogs.remove(catalog.url)}
                >
                  <Trash2 />
                </IconButton>
              )}
            </li>
          )
        })}
      </ul>
      <div className="px-2">
        <Button size="sm" variant="field" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          Add catalog…
        </Button>
      </div>
      <AddCatalogDialog open={adding} catalogs={catalogs} onOpenChange={setAdding} />
    </div>
  )
}

/** The catalogs, live: re-read on every `mini-app-catalogs` poke, counted from the store. */
export function MiniAppCatalogs() {
  const catalogs = useMiniAppCatalogs()
  const { entries } = useMiniAppStore()
  const counts = useMemo(() => countBySource(entries), [entries])
  return <MiniAppCatalogsView catalogs={catalogs} counts={counts} />
}
