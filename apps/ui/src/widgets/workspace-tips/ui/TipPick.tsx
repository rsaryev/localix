import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { TextAction } from '@localixai/kit/text-action'

type TriggerProps = ComponentPropsWithoutRef<typeof TextAction> & {
  /** What the value sets, for assistive tech; the sentence says it to everyone else. */
  label: string
  value: string
}

/**
 * A slide's control is the last words of its sentence: the current value, in the sentence's
 * own type, underlined, with a small chevron. No box and no row of its own, so the scene, the
 * words and the pager read as one piece. A new value arrives with the same blur as the copy.
 */
export const TipPickTrigger = forwardRef<HTMLButtonElement, TriggerProps>(function TipPickTrigger(
  { label, value, className, ...props },
  ref,
) {
  return (
    <TextAction
      ref={ref}
      aria-label={`${label}: ${value}. Change`}
      className={`wt-pick ${className ?? ''}`}
      {...props}
    >
      <span key={value} className="wt-pick-value">
        {value}
      </span>
      <ChevronDown className="wt-pick-chevron" aria-hidden />
    </TextAction>
  )
})

/** A pick from a short list: the inline value opens the app's own menu rows beneath it. */
export function TipPick({
  label,
  value,
  entries,
}: {
  label: string
  value: string
  entries: MenuEntry[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TipPickTrigger label={label} value={value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
