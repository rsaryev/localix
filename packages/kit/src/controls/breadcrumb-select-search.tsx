import * as React from 'react'
import { Search } from 'lucide-react'

import { cn, FIELD_SURFACE } from '@localixai/mini-app-sdk/ui/classes'

const ENABLED_ITEM = '[role="menuitem"]:not([data-disabled])'

interface BreadcrumbSelectSearchProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  placeholder?: string
  /** Whether Enter should activate the first enabled visible row. */
  hasEnabledMatch: boolean
  statusText: string
}

/** The filter field above a long {@link BreadcrumbSelect} list; arrows hand focus to the rows. */
export function BreadcrumbSelectSearch({
  inputRef,
  query,
  onQueryChange,
  placeholder,
  hasEnabledMatch,
  statusText,
}: BreadcrumbSelectSearchProps) {
  return (
    <div className="relative mb-1 shrink-0 border-b border-border-soft px-1 pb-1.5">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-[calc(50%+0.125rem)] text-text-faint"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') return
          if (event.nativeEvent.isComposing) {
            event.stopPropagation()
            return
          }
          const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]')
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            const candidates = Array.from(menu?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? [])
            const target = event.key === 'ArrowDown' ? candidates[0] : candidates.at(-1)
            target?.focus({ preventScroll: true })
            return
          }
          if (event.key === 'Enter') {
            const target =
              query.trim() && hasEnabledMatch
                ? menu?.querySelector<HTMLElement>(ENABLED_ITEM)
                : null
            if (target) {
              event.preventDefault()
              event.stopPropagation()
              target.click()
              return
            }
          }
          event.stopPropagation()
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={placeholder}
        // `focus-ring` alone: the shell is the shared field surface. The element stays native
        // because its key handling hands focus to the menu rows, which SearchInput does not expose.
        className={cn(
          FIELD_SURFACE,
          'h-[var(--chrome-control-md)] w-full pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-text-faint focus-ring',
        )}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {statusText}
      </span>
    </div>
  )
}
