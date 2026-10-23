import { ChevronDown } from 'lucide-react'
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

/**
 * A settings page's "whose / where" pick, as a quiet trigger in its header.
 *
 * The defect it replaces: the agent and project pickers were framed `Select` fields sitting in
 * page headers — a form field where nothing is saved, filled and bordered so it out-shouted the
 * title it qualifies, and folding facts such as "· default" into the option's name. A pick is a
 * menu, not a form: the current answer's icon and name with
 * a chevron, opening onto `selected` rows whose secondary facts are `hint`s.
 */
export function HeaderPickMenu({
  label,
  icon: Icon,
  text,
  entries,
  align = 'end',
}: {
  /** The trigger's accessible name, e.g. "Agent whose rules to edit". */
  label: string
  icon: IconComponent
  /** The current answer, shown on the trigger. */
  text: string
  entries: readonly MenuEntry[]
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={`${label}: ${text}. Change`} className="max-w-56">
          {/* Wrapped: a monogram is not an svg that takes `data-icon`, and the button's inset
              rule reads the slot, not the glyph. */}
          <span data-icon="inline-start" aria-hidden className="inline-flex shrink-0">
            <Icon />
          </span>
          <span className="min-w-0 truncate">{text}</span>
          <ChevronDown data-icon="inline-end" aria-hidden className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
