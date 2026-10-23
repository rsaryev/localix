import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@localixai/kit/dropdown-menu'

export interface OverflowTab {
  id: string
  title: string
  icon?: ReactNode
  italic?: boolean
  dirty?: boolean
  attention?: boolean
}

/**
 * The "show all tabs" affordance (a dropdown of every open editor when the tab
 * strip overflows its width). Rendered by TabStrip ONLY while the strip is
 * clipped (its `renderOverflow` slot, driven by a ResizeObserver), so it appears
 * exactly when a tab has scrolled out of reach and vanishes when all fit. Picking
 * an entry activates that tab; TabStrip then scrolls it back into view.
 */
export function TabOverflowMenu({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: ReadonlyArray<OverflowTab>
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <DropdownMenu>
      <ActionTooltip label="Show all tabs" side="bottom">
        <DropdownMenuTrigger asChild>
          <IconButton size="xs" aria-label="Show all tabs">
            <ChevronDown className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="max-w-72">
        {tabs.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => onSelect(t.id)}
            className={cn('gap-2', t.id === activeId && 'bg-surface-hover text-foreground')}
          >
            {t.attention && t.id !== activeId && (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-info" />
            )}
            {t.icon}
            <span className={cn('min-w-0 flex-1 truncate', t.italic && 'italic')}>{t.title}</span>
            {t.dirty && (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground/70" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
