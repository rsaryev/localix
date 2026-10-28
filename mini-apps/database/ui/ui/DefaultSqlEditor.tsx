import { useId, useMemo, useRef, useState } from 'react'

import { CODE_VIEWER_HIGHLIGHT } from '@localixai/kit/code-block'
import { Popover, PopoverAnchor, PopoverContent } from '@localixai/kit/popover'
import { cn, CONTROL_FOCUS_WITHIN } from '@localixai/mini-app-sdk/ui/classes'
import type { DbDialect } from '../dbClient'
import { defaultSqlCompletions, validateDefaultSqlExpression } from '../model/defaultSql'

const PREVIEW_TOKEN =
  /('(?:''|[^'])*'|\b(?:NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*(?=\s*\())/gi
const PREVIEW_TOKEN_PART =
  /^('(?:''|[^'])*'|(?:NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)|\d+(?:\.\d+)?|[A-Za-z_]\w*)$/i

function tokenColor(token: string): string {
  if (token.startsWith("'")) return 'var(--sh-string)'
  if (/^\d/.test(token)) return 'var(--sh-property)'
  if (/^[A-Za-z_]\w*$/.test(token) && !/^(NULL|TRUE|FALSE|CURRENT_)/i.test(token))
    return 'var(--sh-entity)'
  return 'var(--sh-keyword)'
}

/** Token-coloured mirror behind the transparent native input. */
function SqlExpressionHighlight({ value }: { value: string }) {
  return (
    <>
      {value.split(PREVIEW_TOKEN).map((part, index) =>
        PREVIEW_TOKEN_PART.test(part) ? (
          <span key={`${index}:${part}`} style={{ color: tokenColor(part) }}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function completionQuery(value: string, cursor: number): string {
  const before = value.slice(0, cursor)
  return /[A-Za-z_]\w*$/.exec(before)?.[0] ?? before.trim()
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[\s_()[\]'":.-]/g, '')
}

/**
 * Dense inline DEFAULT editor. The native input owns caret/selection/IME behavior while a
 * mirrored layer supplies token colours. Suggestions use the project's anchored Popover,
 * avoiding Monaco's overflow-widget coordinates inside nested portals.
 */
export function DefaultSqlEditor({
  value,
  columnName,
  dataType,
  dialect,
  disabled,
  disabledReason,
  emptyLabel,
  onChange,
}: {
  value: string
  columnName: string
  dataType: string
  dialect: DbDialect
  disabled?: boolean
  /** Why this field is disabled. A control the user cannot use must say what is stopping them. */
  disabledReason?: string
  /** Replaces the "No default" placeholder — e.g. a generated column's own expression. */
  emptyLabel?: string
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const validationError = useMemo(() => validateDefaultSqlExpression(value), [value])
  const completions = useMemo(() => defaultSqlCompletions(dialect, dataType), [dialect, dataType])
  // Where the caret is, kept as state from the input's own events instead of read off the DOM
  // node while rendering; before the first event it sits at the end, like an untouched input.
  const [caret, setCaret] = useState<number | null>(null)
  const cursor = Math.min(caret ?? value.length, value.length)
  const query = completionQuery(value, cursor)
  const normalizedQuery = normalizeSearch(query)
  const matching = useMemo(
    () =>
      completions
        .filter((item) => {
          if (showAll || !normalizedQuery) return true
          return normalizeSearch(`${item.label} ${item.detail ?? ''}`).includes(normalizedQuery)
        })
        .slice(0, 7),
    [completions, normalizedQuery, showAll],
  )
  const label = `Default SQL for ${columnName || 'new column'}`
  const popupOpen = open && !disabled && (matching.length > 0 || !!validationError)
  // The combobox has to name the list it controls and the option inside it that is current, and the
  // ids have to survive several editors on one page, so they come from React rather than constants.
  const instanceId = useId()
  const popupId = `sql-suggestions-${instanceId}`
  const optionId = (index: number) => `${popupId}-option-${index}`

  const showMatches = (nextValue: string, cursorAt: number) => {
    const nextQuery = normalizeSearch(completionQuery(nextValue, cursorAt))
    const hasMatch = completions.some((item) =>
      normalizeSearch(`${item.label} ${item.detail ?? ''}`).includes(nextQuery),
    )
    setShowAll(false)
    setSelected(0)
    setOpen(!!nextQuery && hasMatch)
  }

  const accept = (next: string) => {
    onChange(next)
    setOpen(false)
    setShowAll(false)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const caretAt = next === "''" ? 1 : next.length
      input.setSelectionRange(caretAt, caretAt)
      setCaret(caretAt)
    })
  }

  return (
    <Popover open={popupOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            // The shared field fill: a foreground veil, not `--input` (opaque grey in the plain
            // dark theme) and not `bg-background` (the pane's own ground — under glass the
            // once-only rule cleared it and this one-line editor lost its fill entirely).
            'relative h-7 min-w-0 overflow-hidden rounded-sm border border-control-border bg-foreground/[0.04] font-mono text-2xs',
            CONTROL_FOCUS_WITHIN,
            validationError && 'border-status-error/60',
            disabled && 'opacity-50',
            CODE_VIEWER_HIGHLIGHT,
          )}
          title={validationError ?? disabledReason}
        >
          <div
            ref={highlightRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 whitespace-pre text-foreground"
          >
            {value ? (
              <SqlExpressionHighlight value={value} />
            ) : (
              <span className="truncate text-text-faint">{emptyLabel ?? 'No default'}</span>
            )}
          </div>
          <input
            ref={inputRef}
            value={value}
            disabled={disabled}
            aria-label={label}
            aria-invalid={!!validationError}
            // `aria-expanded` says nothing on a plain textbox: the role that owns an expandable
            // popup is `combobox`, and without it a screen reader never announces that suggestions
            // appeared.
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={popupOpen}
            aria-controls={popupId}
            aria-activedescendant={popupOpen ? optionId(selected) : undefined}
            spellCheck={false}
            autoComplete="off"
            onScroll={(event) => {
              if (highlightRef.current)
                highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onChange={(event) => {
              const next = event.target.value.replaceAll(/\r?\n/g, ' ')
              onChange(next)
              setCaret(event.target.selectionStart)
              showMatches(next, event.target.selectionStart ?? next.length)
            }}
            onClick={(event) => {
              if (!open) return
              showMatches(value, event.currentTarget.selectionStart ?? value.length)
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
                event.preventDefault()
                setShowAll(true)
                setSelected(0)
                setOpen(true)
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (!open) {
                  setShowAll(true)
                  setSelected(0)
                  setOpen(true)
                } else {
                  setSelected((current) => Math.min(current + 1, matching.length - 1))
                }
                return
              }
              if (event.key === 'ArrowUp' && open) {
                event.preventDefault()
                setSelected((current) => Math.max(current - 1, 0))
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && open && matching[selected]) {
                event.preventDefault()
                accept(matching[selected].insertText ?? matching[selected].label)
                return
              }
              if (event.key === 'Escape' && open) {
                event.preventDefault()
                setOpen(false)
              }
            }}
            className={cn(
              'absolute inset-0 h-full w-full bg-transparent px-2 font-mono text-2xs text-transparent caret-foreground outline-none',
              // The app's own 24% foreground selection highlight, not `bg-accent/25`: `accent` is
              // itself a 6% veil under glass, so `/25` of it was a 1.5% fill — and since this
              // input's text is transparent (the highlight layer below draws it), that highlight
              // is the ONLY way to see what you selected.
              'selection:bg-foreground/24 selection:text-transparent',
              disabled && 'cursor-not-allowed',
            )}
          />
        </div>
      </PopoverAnchor>

      {popupOpen && (
        <PopoverContent
          id={popupId}
          role="listbox"
          align="start"
          sideOffset={3}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="w-72 gap-0 rounded-md p-1"
        >
          {validationError && (
            <div className="border-b border-border-soft px-2 py-1.5 text-2xs text-status-error">
              {validationError}
            </div>
          )}
          {matching.map((item, index) => (
            <button
              key={item.label}
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => accept(item.insertText ?? item.label)}
              className={cn(
                'flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left',
                index === selected ? 'bg-surface-hover text-foreground' : 'text-text-soft',
              )}
            >
              <code className="min-w-0 flex-1 truncate font-mono text-2xs">{item.label}</code>
              {item.detail && (
                <span className="max-w-28 truncate text-3xs text-text-faint">{item.detail}</span>
              )}
            </button>
          ))}
        </PopoverContent>
      )}
    </Popover>
  )
}
