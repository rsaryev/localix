import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { FindWidgetCount, FindWidgetInput, FindWidgetSurface } from '@localixai/kit/find-widget'
import { IconButton } from '@localixai/kit/icon-button'

export interface FindState {
  open: boolean
  term: string
  caseSensitive: boolean
  count: number
  index: number
}

/**
 * The in-terminal find widget (⌘/Ctrl+F): a small floating input + match counter +
 * case toggle + prev/next/close. Presentational — all search behavior lives in the
 * `runSearch` callback the pane owns (backed by the xterm search addon); this only
 * renders the controls and threads keystrokes back through `setFind`/`runSearch`.
 */
export function TerminalFindWidget({
  find,
  inputRef,
  setFind,
  runSearch,
  onClose,
}: {
  find: FindState
  inputRef: RefObject<HTMLInputElement | null>
  setFind: Dispatch<SetStateAction<FindState>>
  runSearch: (query: string, opts: { caseSensitive: boolean; forward: boolean }) => void
  onClose: () => void
}) {
  const hasMatches = find.term.trim().length > 0 && find.count > 0

  return (
    <FindWidgetSurface aria-label="Find in terminal">
      <Search className="ml-1 size-3.5 shrink-0 text-text-faint" />
      <FindWidgetInput
        ref={inputRef}
        value={find.term}
        placeholder="Find"
        aria-label="Find in terminal"
        onChange={(e) => {
          const query = e.target.value
          setFind((f) => ({ ...f, term: query }))
          runSearch(query, { caseSensitive: find.caseSensitive, forward: true })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            runSearch(find.term, { caseSensitive: find.caseSensitive, forward: !e.shiftKey })
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <FindWidgetCount query={find.term} count={find.count} index={find.index} />
      <IconButton
        size="sm"
        aria-label="Match case"
        aria-pressed={find.caseSensitive}
        tooltip="Match case"
        className="text-2xs"
        onClick={() => {
          const caseSensitive = !find.caseSensitive
          setFind((f) => ({ ...f, caseSensitive }))
          runSearch(find.term, { caseSensitive, forward: true })
        }}
      >
        Aa
      </IconButton>
      <IconButton
        size="sm"
        disabled={!hasMatches}
        aria-label="Previous match"
        tooltip="Previous (⇧⏎)"
        onClick={() => runSearch(find.term, { caseSensitive: find.caseSensitive, forward: false })}
      >
        <ChevronUp className="size-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        disabled={!hasMatches}
        aria-label="Next match"
        tooltip="Next (⏎)"
        onClick={() => runSearch(find.term, { caseSensitive: find.caseSensitive, forward: true })}
      >
        <ChevronDown className="size-3.5" />
      </IconButton>
      <IconButton size="sm" aria-label="Close find" tooltip="Close (Esc)" onClick={onClose}>
        <X className="size-3.5" />
      </IconButton>
    </FindWidgetSurface>
  )
}
