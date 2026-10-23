import { useMemo, useState } from 'react'
import { Check, ChevronDown, GitFork, Plus } from 'lucide-react'

import type { UiSession } from '@/shared/api/contracts'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { SectionLabel } from '@localixai/kit/section-label'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { sessionTitle } from './sessionTitle'

interface SessionPathSegmentProps {
  session: UiSession
  /** All sessions, used to find this segment's direct children. */
  sessions: UiSession[]
  /** True for the last (active) segment — only it gets the fork dropdown / + action. */
  isCurrent: boolean
  /** The child id that continues the active path, highlighted in the menu. */
  activeChildId?: string | null
  onSelect: (id: string) => void
  /** Fork the active chat (only wired on the current segment). */
  onFork?: () => void
  disabled?: boolean
}

// Shared button look so a path segment reads as a real, tappable control
// (hover fill + rounded) rather than a link.
// `surface-hover`, not `bg-surface-sunken`: sunken is a BLACK 45% veil under glass — right for a
// pane-sized inset, wrong on a segment-sized control, where it read as a hole opening under the cursor.
const SEGMENT_BTN =
  'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 leading-none outline-none transition-colors cursor-pointer hover:bg-surface-hover focus-ring'

/**
 * One breadcrumb segment. Ancestors are plain navigation buttons. The current
 * (last) segment is interactive: if it has forks, its NAME opens a dropdown to
 * switch between them or fork again; if it has none, a "+" beside it forks the
 * chat instantly.
 */
export function SessionPathSegment({
  session,
  sessions,
  isCurrent,
  activeChildId,
  onSelect,
  onFork,
  disabled,
}: SessionPathSegmentProps) {
  const [open, setOpen] = useState(false)
  const title = sessionTitle(session)

  const children = useMemo(
    () =>
      sessions
        .filter((s) => s.parentSessionId === session.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [sessions, session.id],
  )

  // --- Ancestor segment: a plain navigation button. -------------------------
  if (!isCurrent) {
    return (
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className={cn(
          SEGMENT_BTN,
          'max-w-[12rem] truncate text-xs text-text-soft hover:text-foreground',
        )}
        title={title}
      >
        <span className="truncate">{title}</span>
      </button>
    )
  }

  // --- Current segment, with forks: the name itself is the dropdown. --------
  if (children.length > 0) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Switch or fork conversation"
            aria-current="page"
            title={`${children.length} child session${children.length === 1 ? '' : 's'} — open or fork`}
            // Open state = the 11% `surface-active` veil, not `bg-surface-raised`: raised mixes
            // from a darker ground than the breadcrumb bar, so an open segment read as a black box.
            className={cn(
              SEGMENT_BTN,
              'max-w-full text-sm font-medium text-foreground',
              open && 'bg-surface-active',
            )}
            // Already on this session — the whole segment just opens the fork
            // menu (there's nowhere faster to "navigate" to).
          >
            <span className="truncate">{title}</span>
            <ChevronDown
              className={cn(
                'size-3 shrink-0 text-text-faint transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-1.5"
        >
          <SectionLabel className="px-1.5 pt-0.5 pb-1">Children of “{title}”</SectionLabel>
          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            {children.map((child) => {
              const onPath = child.id === activeChildId
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onSelect(child.id)
                  }}
                  // `popover-hover` like every other menu row, not `bg-surface-sunken`: sunken is
                  // a BLACK 45% veil, which on a row inside a frosted popover read as a black band.
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs outline-none transition-colors hover:bg-popover-hover cursor-pointer focus-ring',
                    onPath ? 'text-foreground' : 'text-text-soft',
                  )}
                  title={sessionTitle(child)}
                >
                  <GitFork className="size-3 shrink-0 -scale-x-100 opacity-50" />
                  <span className="min-w-0 flex-1 truncate">{sessionTitle(child)}</span>
                  {onPath ? (
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-status-success">
                      <Check className="size-3" aria-hidden="true" />
                      on path
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          {onFork ? (
            <div className="mt-0.5 border-t border-border-soft pt-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setOpen(false)
                  onFork()
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-text-soft outline-none transition-colors focus-ring',
                  disabled
                    ? 'opacity-50'
                    : // Menu-row hover veil, not the BLACK 45% `surface-sunken`.
                      'hover:bg-popover-hover hover:text-foreground cursor-pointer',
                )}
              >
                <Plus className="size-3 shrink-0" />
                <span>Fork this chat into a new conversation</span>
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    )
  }

  // --- Current segment, no forks: name + a "+" that forks instantly. --------
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <span
        aria-current="page"
        className="max-w-full truncate px-1.5 py-1 text-sm font-medium leading-none text-foreground"
        title={title}
      >
        {title}
      </span>
      {onFork ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFork()}
          aria-label="Fork this chat"
          title="Fork this chat into a new conversation"
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md text-text-faint outline-none transition-colors focus-ring',
            disabled
              ? 'opacity-50'
              : // 7% veil, not the BLACK 45% `surface-sunken`, on an icon-sized control.
                'hover:bg-surface-hover hover:text-foreground cursor-pointer',
          )}
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
