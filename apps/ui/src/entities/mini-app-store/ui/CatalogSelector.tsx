import { BookMarked, ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MiniAppCatalogEntryRecord } from '@localixai/api/client'
import { catalogLabel } from '../model/storeFilters'

/**
 * Which catalog the store shows, at the right of its tab row: every catalog, or one of them with
 * how many apps it offers. The same menu removes a catalog someone added (never the Localix one)
 * and opens "Add catalog…".
 */
export function CatalogSelector({
  catalogs,
  counts,
  active,
  onChoose,
  onRemove,
  onAdd,
}: {
  catalogs: MiniAppCatalogEntryRecord[]
  counts: Record<string, number>
  /** A catalog's address, or null for all of them. */
  active: string | null
  onChoose: (url: string | null) => void
  onRemove: (url: string) => void
  onAdd: () => void
}) {
  const activeCatalog = catalogs.find((catalog) => catalog.url === active)
  const current = activeCatalog ? catalogLabel(activeCatalog) : 'All catalogs'
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const added = catalogs.filter((catalog) => !catalog.builtIn)
  const entries: MenuEntry[] = [
    {
      id: 'all',
      label: 'All catalogs',
      hint: String(total),
      selected: active === null,
      onSelect: () => onChoose(null),
    },
    ...catalogs.map((catalog) => ({
      id: `catalog:${catalog.url}`,
      label: catalogLabel(catalog),
      description: catalog.builtIn ? 'Comes with Localix' : catalog.url,
      hint: String(counts[catalog.url] ?? 0),
      selected: active === catalog.url,
      onSelect: () => onChoose(catalog.url),
    })),
    { separator: true },
    ...added.map((catalog) => ({
      id: `remove:${catalog.url}`,
      label: `Remove ${catalogLabel(catalog)}`,
      icon: Trash2,
      danger: true,
      onSelect: () => onRemove(catalog.url),
    })),
    { separator: true },
    { id: 'add', label: 'Add catalog…', icon: Plus, onSelect: onAdd },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="default" variant="ghost" aria-label={`Catalogs: ${current}`}>
          <BookMarked data-icon="inline-start" aria-hidden />
          <span className="max-w-40 truncate">{current}</span>
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
