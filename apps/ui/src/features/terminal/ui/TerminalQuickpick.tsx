import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { Input } from '@localixai/kit/input'
import { ResultCountStatus } from '@localixai/mini-app-sdk/ui/result-count-status'
import {
  PaneDialog,
  PaneDialogContent,
  PaneDialogDescription,
  PaneDialogTitle,
} from '@localixai/kit/dialog'

/**
 * Pane-local quick-pick shell for a terminal pane's keyboard-first palettes (today the
 * link quickpick, ⌘/Ctrl+⇧+O).
 *
 * One source of truth for the overlay: a dimmed backdrop, a centered panel, a
 * filter input, and a keyboard-navigable list (↑/↓ move, Enter chooses, Esc
 * closes; the highlighted row is kept in view; the empty state reuses the shared
 * `EmptyHint`). Consumers own only what a row LOOKS like (`renderRow`) and what
 * choosing one DOES (`onChoose`) — so a palette stays pixel- and
 * behaviour-consistent without duplicating the shell. Exposes proper combobox /
 * listbox / option a11y roles so the whole thing is reachable to a screen reader.
 */
export function TerminalQuickpick<T>({
  items,
  filter,
  placeholder,
  ariaLabel,
  emptyText,
  renderRow,
  itemKey,
  onChoose,
  onClose,
  align = 'center',
  footer,
}: {
  items: T[]
  /** Pure, referentially-stable filter (typically a module-level function). */
  filter: (items: T[], query: string) => T[]
  placeholder: string
  ariaLabel: string
  /** Shown centered when the filtered list is empty (string or rich node). */
  emptyText: ReactNode
  /** Row inner content; the shell owns the <button>, selection + click wiring. */
  renderRow: (item: T, index: number) => ReactNode
  /** Stable key per row (defaults to the index). */
  itemKey?: (item: T, index: number) => string
  /** A row was chosen (Enter or click). */
  onChoose: (item: T, index: number) => void
  onClose: () => void
  /** Multi-line rows align to the top; single-line rows center (default). */
  align?: 'center' | 'start'
  /** Optional pinned footer (e.g. a "Custom command…" action). */
  footer?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const filtered = useMemo(() => filter(items, query), [items, filter, query])

  // Keep the highlighted row in view as it moves / the list narrows.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, filtered.length])
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  const choose = (i: number) => {
    const item = filtered[i]
    if (item != null) onChoose(item, i)
  }

  return (
    <PaneDialog onClose={onClose}>
      <PaneDialogContent className="max-h-[70%]">
        <PaneDialogTitle className="sr-only">{ariaLabel}</PaneDialogTitle>
        <PaneDialogDescription className="sr-only">
          Type to filter, then use the arrow keys and Enter to choose.
        </PaneDialogDescription>
        <Input
          size="xl"
          value={query}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={filtered.length ? `${listId}-${active}` : undefined}
          className="shrink-0 rounded-none border-x-0 border-t-0 border-b-border bg-transparent focus-ring"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (filtered.length > 0) setActive((a) => Math.min(a + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (filtered.length > 0) setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(active)
            }
          }}
        />
        <ResultCountStatus count={filtered.length} />
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <EmptyHint className="p-4 text-xs">{emptyText}</EmptyHint>
          ) : (
            filtered.map((item, i) => (
              <button
                key={itemKey ? itemKey(item, i) : i}
                type="button"
                role="option"
                id={`${listId}-${i}`}
                aria-selected={i === active}
                data-active={i === active}
                className={`flex w-full gap-2 px-3 py-1.5 text-left text-xs ${align === 'start' ? 'items-start' : 'items-center'} ${
                  i === active
                    ? 'bg-surface-hover text-foreground'
                    : 'text-text-soft hover:bg-surface-hover'
                }`}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {renderRow(item, i)}
              </button>
            ))
          )}
        </div>
        {footer}
      </PaneDialogContent>
    </PaneDialog>
  )
}
