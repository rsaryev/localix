import type { ComponentType } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { SectionLabel } from './section-label'

export interface ShelfNavItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  /** How many it holds; shown at the end of the row. */
  count?: number
}

export interface ShelfNavGroup {
  id: string
  /** A small caps heading; a group without one sits at the top. */
  label?: string
  items: readonly ShelfNavItem[]
}

/**
 * The sections of a pane that browses a collection, grouped under small headings, one current —
 * a store's Discover, its kinds, its library. A group with no items is not drawn, so a section
 * that holds nothing is hidden by leaving it out. Rows are 28px with a count at the end.
 */
export function ShelfNav({
  groups,
  active,
  onSelect,
  label,
  className,
}: {
  groups: readonly ShelfNavGroup[]
  active: string
  onSelect: (id: string) => void
  label: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('flex flex-col gap-3', className)}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.label && <SectionLabel className="px-2 pb-0.5">{group.label}</SectionLabel>}
            {group.items.map(({ id, label: itemLabel, icon: Icon, count }) => (
              <button
                key={id}
                type="button"
                aria-current={id === active ? 'page' : undefined}
                onClick={() => onSelect(id)}
                className={cn(
                  'flex h-(--chrome-control-md) items-center gap-2 rounded-sm px-2 text-left text-sm focus-ring',
                  id === active
                    ? 'bg-surface-active text-foreground'
                    : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
                {count !== undefined && (
                  <span className="shrink-0 text-2xs text-text-faint tabular-nums">{count}</span>
                )}
              </button>
            ))}
          </div>
        ))}
    </nav>
  )
}
