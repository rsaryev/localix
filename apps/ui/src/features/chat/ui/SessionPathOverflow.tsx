import { useState } from 'react'
import { Ellipsis } from 'lucide-react'

import type { UiSession } from '@/shared/api/contracts'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { cn } from '@localixai/plugin-sdk/ui/classes'

interface SessionPathOverflowProps {
  /** Collapsed ancestor sessions (oldest → newest), hidden to cap the path depth. */
  sessions: UiSession[]
  onSelect: (id: string) => void
}

/**
 * A "…" breadcrumb node that stands in for ancestors hidden when the lineage is
 * deeper than the visible cap. Opens a dropdown to jump to any collapsed one.
 */
export function SessionPathOverflow({ sessions, onSelect }: SessionPathOverflowProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Show earlier conversations in the path"
          title={`${sessions.length} earlier conversation${sessions.length === 1 ? '' : 's'}`}
          // Veils, not ground tokens: `surface-sunken` is a BLACK 45% veil and `surface-raised`
          // mixes from a darker ground than the breadcrumb bar, so both read as a black square
          // on a control this small. The 7%/11% veils only add density to the bar's own colour.
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer focus-ring',
            open && 'bg-surface-active text-foreground',
          )}
        >
          <Ellipsis className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-1.5"
      >
        <div className="px-1.5 pt-0.5 pb-1 text-xs font-medium uppercase tracking-wide text-text-soft">
          Earlier in this path
        </div>
        <div className="max-h-72 overflow-y-auto scrollbar-thin">
          {sessions.map((session, index) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                setOpen(false)
                onSelect(session.id)
              }}
              style={{ paddingLeft: `${8 + index * 14}px` }}
              // `popover-hover` like every other menu row, not the BLACK 45% `surface-sunken`.
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-text-soft outline-none transition-colors hover:bg-popover-hover hover:text-foreground cursor-pointer focus-ring"
              title={session.title || 'Untitled Chat'}
            >
              <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled Chat'}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
