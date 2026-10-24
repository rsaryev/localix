import { BookMarked, ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { SourceView } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

/**
 * Which source a shelf shows, at the right of its tab row: every source, or one of them with how
 * many of the shelf's packages it offers. The same menu removes a source someone added (never one
 * that comes with Localix) and opens "Add source…".
 */
export function SourceMenu({
  sources,
  counts,
  active,
  onChoose,
  onRemove,
  onAdd,
}: {
  sources: readonly SourceView[]
  counts: Record<string, number>
  /** A source's id, or null for all of them. */
  active: string | null
  onChoose: (id: string | null) => void
  onRemove: (source: SourceView) => void
  onAdd?: () => void
}) {
  const current = sources.find((source) => source.id === active)?.label ?? 'All sources'
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const added = sources.filter((source) => !source.builtIn)
  const entries: MenuEntry[] = [
    {
      id: 'all',
      label: 'All sources',
      hint: String(total),
      selected: active === null,
      onSelect: () => onChoose(null),
    },
    ...sources.map((source) => ({
      id: `source:${source.id}`,
      label: source.label,
      hint: String(counts[source.id] ?? 0),
      selected: active === source.id,
      onSelect: () => onChoose(source.id),
    })),
    { separator: true },
    ...added.map((source) => ({
      id: `remove:${source.id}`,
      label: `Remove ${source.label.replace(/^A /, 'a ')}`,
      icon: Trash2,
      danger: true,
      onSelect: () => onRemove(source),
    })),
    ...(onAdd
      ? [
          { separator: true } as const,
          { id: 'add', label: 'Add source…', icon: Plus, onSelect: onAdd },
        ]
      : []),
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="default" variant="ghost" aria-label={`Sources: ${current}`}>
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
