import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { CommandItem } from '@localixai/kit/command'
import { SELECTED_ROW } from '@localixai/kit/selected-row'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { CatalogModel } from '@localixai/agent/catalog'
import { FavoriteStar } from './FavoriteStar'
import { PICKER_ROW_META } from './pickerRow'

interface ModelListItemProps {
  model: CatalogModel
  value?: string
  /** Where the model comes from, for lists that span connections (Recent, Favorites). */
  secondary?: ReactNode
  selected: boolean
  onSelect: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  favorited: boolean
  onToggleFavorite: () => void
}

/**
 * One model in the list. The list is for CHOOSING; the spec and the per-model settings (the
 * reasoning level) live in the details panel, so a row holds nothing that floats over its
 * neighbours.
 *
 * Two states read differently on purpose. The keyboard/hover highlight is the quiet
 * `surface-hover` veil; the model this target RUNS on is the picker's selected fill plus a check,
 * because a fill alone looked exactly like the row the pointer happened to rest on. The check
 * keeps its slot on every row, so the star beside it never shifts between rows.
 */
export function ModelListItem({
  model,
  value = model.id,
  secondary,
  selected,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  favorited,
  onToggleFavorite,
}: ModelListItemProps) {
  return (
    <CommandItem
      value={value}
      showCheck={false}
      onSelect={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'group/model-row min-h-(--chrome-control-lg) cursor-pointer gap-2 rounded-md px-1.5 py-1 text-xs shadow-none transition-colors duration-(--dur-fast) data-selected:bg-surface-hover data-selected:text-foreground data-selected:shadow-none',
        selected
          ? cn(SELECTED_ROW, 'font-medium shadow-none data-selected:bg-sidebar-accent')
          : 'text-foreground',
      )}
    >
      <span data-slot="model-row-name" className="min-w-0 flex-1 break-words leading-5">
        {model.name}
      </span>
      {secondary != null && (
        <span className={cn(PICKER_ROW_META, 'max-w-[40%] truncate font-normal')}>{secondary}</span>
      )}
      <span
        data-slot="model-row-current"
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center"
      >
        {selected && <Check className="size-3.5" />}
      </span>
      <FavoriteStar
        favorited={favorited}
        onToggle={onToggleFavorite}
        className={cn(
          // `lx-hover-actions` is also what shows it on a touch screen, which has no hover.
          !favorited &&
            'lx-hover-actions opacity-0 group-hover/model-row:opacity-100 group-focus-within/model-row:opacity-100 group-data-selected/model-row:opacity-100',
        )}
      />
    </CommandItem>
  )
}
