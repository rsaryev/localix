import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { SearchInput } from '@localixai/kit/search-input'
import { ResultCountStatus } from '@localixai/plugin-sdk/ui/result-count-status'
import {
  Autocomplete,
  AutocompleteAnchor,
  AutocompleteList,
  AutocompleteOption,
} from '@localixai/kit/autocomplete'
import { SETTINGS_INDEX } from '../model/settingsIndex'
import { searchSettings } from '../model/settingsSearch'
import type { SettingsIndexEntry } from '../model/settingsIndex'
import { settingsTargetUri } from '@/shared/lib/settingsAnchors'

/**
 * A single search box that filters EVERY setting across all tabs and jumps to
 * the tab that owns the match. It reads
 * the declarative `SETTINGS_INDEX` — it does not render settings itself.
 */
export function SettingsSearch({
  onNavigate,
  className,
}: {
  /** Open the result through the same canonical URI path used outside Settings. */
  onNavigate: (uri: string) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const results = useMemo(() => searchSettings(SETTINGS_INDEX, query).slice(0, 8), [query])
  const showResults = open && query.trim().length > 0
  const activeOptionId =
    showResults && results.length > 0 ? `${listId}-option-${active}` : undefined

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const pick = (entry: SettingsIndexEntry) => {
    onNavigate(settingsTargetUri({ tab: entry.tab, anchor: entry.anchor, entryId: entry.id }))
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || results.length === 0) {
      if (e.key === 'Escape') setQuery('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = results[active] ?? results[0]
      if (chosen) pick(chosen.entry)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <div className={className}>
      <Autocomplete open={showResults} onOpenChange={setOpen}>
        <AutocompleteAnchor asChild>
          <div>
            <SearchInput
              size="xl"
              inset
              value={query}
              onValueChange={(value) => {
                setQuery(value)
                setOpen(true)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search settings…"
              aria-label="Search settings"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={showResults}
              aria-controls={showResults ? listId : undefined}
              aria-activedescendant={activeOptionId}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
            />
          </div>
        </AutocompleteAnchor>
        {showResults && (
          <>
            <ResultCountStatus count={results.length} singular="setting" plural="settings" />
            <AutocompleteList
              ref={listRef}
              id={listId}
              aria-label="Settings search results"
              sideOffset={8}
              className="max-h-[min(20rem,var(--radix-popover-content-available-height))] p-1.5"
            >
              {results.length === 0 ? (
                <div className="px-3 py-4 text-xs text-text-faint">No settings found</div>
              ) : (
                results.map((result, index) => (
                  <AutocompleteOption
                    key={result.entry.id}
                    id={`${listId}-option-${index}`}
                    active={index === active}
                    onClick={() => pick(result.entry)}
                    onMouseEnter={() => setActive(index)}
                    className="flex-col items-stretch gap-1 px-3 py-2.5 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {result.entry.title}
                      </span>
                      <span className="ml-auto shrink-0 text-2xs font-medium text-text-faint">
                        {result.entry.tabLabel}
                      </span>
                    </span>
                    <span className="truncate text-xs leading-4 text-text-soft">
                      {result.entry.description}
                    </span>
                  </AutocompleteOption>
                ))
              )}
            </AutocompleteList>
          </>
        )}
      </Autocomplete>
    </div>
  )
}
