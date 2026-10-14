import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Clock3, RotateCw } from 'lucide-react'
import { Input } from '@localixai/kit/input'
import { IconButton } from '@localixai/kit/icon-button'
import {
  Autocomplete,
  AutocompleteAnchor,
  AutocompleteList,
  AutocompleteOption,
} from '@localixai/kit/autocomplete'
import { useBrowserHistory, visitName } from '../model/browserHistory'
import { readableAddress, resolvePreviewAddress } from '../model/previewAddress'

/** The one address bar every browser page gets, whichever engine renders the page below it. */
export function PreviewAddressBar({
  url,
  onNavigate,
  onReload,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
  startFocused = false,
}: {
  url: string
  onNavigate?: (url: string) => void
  onReload?: () => void
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  /** A new tab has nothing to show until the person types, so it starts in the field. */
  startFocused?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // Idle, the field shows a readable address; editing, the exact URL, all of it selected.
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  // Only a tab the person just opened asks for this, so focus follows their own gesture. That
  // page lists recent sites itself, so the history list waits for typing instead of covering it.
  const quietFocus = useRef(false)
  useLayoutEffect(() => {
    if (!startFocused) return
    quietFocus.current = true
    input.current?.focus()
  }, [startFocused])
  const listId = useId()
  const visits = useBrowserHistory((state) => state.visits)
  const query = (draft ?? '').trim().toLowerCase()
  const suggestions = useMemo(() => {
    const matching = query
      ? visits.filter(
          (visit) =>
            visit.url.toLowerCase().includes(query) || visit.title?.toLowerCase().includes(query),
        )
      : visits
    return matching.slice(0, 8)
  }, [visits, query])
  // The list is a shared popover, so it claims the focus stack while it is up — which is also
  // what makes a native browser page below this bar step aside for it.
  const showSuggestions = open && !!onNavigate && suggestions.length > 0

  const navigate = (next: string) => {
    onNavigate?.(next)
    setDraft(null)
    setOpen(false)
    setActive(-1)
    setInvalid(false)
  }
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-0.5"
      role="group"
      aria-label="Browser navigation"
    >
      {onBack && (
        <IconButton
          size="sm"
          aria-label="Go back"
          tooltip="Go back"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
        </IconButton>
      )}
      {onForward && (
        <IconButton
          size="sm"
          aria-label="Go forward"
          tooltip="Go forward"
          disabled={!canGoForward}
          onClick={onForward}
        >
          <ArrowRight className="size-3.5" />
        </IconButton>
      )}
      {onReload && (
        <IconButton size="sm" aria-label="Reload page" tooltip="Reload page" onClick={onReload}>
          <RotateCw className="size-3.5" />
        </IconButton>
      )}
      <Autocomplete open={showSuggestions} onOpenChange={setOpen}>
        <AutocompleteAnchor asChild>
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!onNavigate) return
              if (active >= 0 && suggestions[active]) {
                navigate(suggestions[active].url)
                return
              }
              const next = resolvePreviewAddress(draft ?? url, url)
              setInvalid(!next)
              if (next) navigate(next)
            }}
          >
            <Input
              ref={input}
              aria-label="Browser address"
              placeholder="Search Google or enter a URL"
              aria-invalid={invalid}
              readOnly={!onNavigate}
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={showSuggestions}
              aria-controls={showSuggestions ? listId : undefined}
              aria-activedescendant={
                showSuggestions && active >= 0 ? `${listId}-option-${active}` : undefined
              }
              value={draft ?? (editing ? url : readableAddress(url))}
              className="min-w-0 text-xs"
              title={invalid ? 'Enter a web address or search text' : url}
              onChange={(event) => {
                setDraft(event.target.value)
                setInvalid(false)
                setActive(-1)
                setOpen(true)
              }}
              onFocus={() => {
                setEditing(true)
                if (quietFocus.current) quietFocus.current = false
                else setOpen(true)
              }}
              onBlur={() => {
                setEditing(false)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setDraft(null)
                  setInvalid(false)
                  setOpen(false)
                  setActive(-1)
                  event.currentTarget.blur()
                } else if (event.key === 'ArrowDown' && suggestions.length) {
                  event.preventDefault()
                  setActive((index) => (index + 1) % suggestions.length)
                  setOpen(true)
                } else if (event.key === 'ArrowUp' && suggestions.length) {
                  event.preventDefault()
                  setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
                  setOpen(true)
                }
              }}
            />
          </form>
        </AutocompleteAnchor>
        {showSuggestions && (
          // Always drawn over a page the app does not own, so it takes the opaque panel: the
          // glass one frosts over that page and washes out on anything bright.
          <AutocompleteList
            id={listId}
            aria-label="Browser history"
            sideOffset={4}
            material="foreign"
          >
            {suggestions.map((visit, index) => {
              const name = visitName(visit)
              return (
                <AutocompleteOption
                  key={visit.url}
                  id={`${listId}-option-${index}`}
                  active={active === index}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => navigate(visit.url)}
                  className="min-w-0 gap-2 text-left"
                >
                  <Clock3 className="size-3.5 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-foreground">{name.title}</span>
                    {name.address && (
                      <span className="ml-2 text-2xs text-text-soft">{name.address}</span>
                    )}
                  </span>
                </AutocompleteOption>
              )
            })}
          </AutocompleteList>
        )}
      </Autocomplete>
    </div>
  )
}
