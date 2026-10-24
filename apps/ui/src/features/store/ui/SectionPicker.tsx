import type { LucideIcon } from 'lucide-react'
import type { ShelfNavGroup } from '@localixai/kit/shelf-nav'
import { Select } from '@localixai/kit/select'

/**
 * The Store's sections as one picker, for a pane too narrow for the shelf column: the same
 * groups and counts as the column, in its order.
 */
export function SectionPicker({
  groups,
  active,
  onSelect,
  className,
}: {
  groups: readonly ShelfNavGroup[]
  active: string
  onSelect: (id: string) => void
  className?: string
}) {
  const options = groups.flatMap((group) =>
    group.items.map((item) => ({
      value: item.id,
      label: item.count === undefined ? item.label : `${item.label} · ${item.count}`,
      // The shelves' glyphs are lucide icons; the column takes any component.
      icon: item.icon as LucideIcon | undefined,
    })),
  )
  return (
    <div className={className}>
      <Select
        aria-label="Store section"
        value={active}
        placeholder="Results"
        onValueChange={onSelect}
        options={options}
        size="md"
      />
    </div>
  )
}
