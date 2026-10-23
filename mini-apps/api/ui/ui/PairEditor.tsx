/**
 * An editable name/value list for headers, query parameters, and path parameters, which share the
 * same data shape.
 *
 * The `disabled` checkbox is not decoration. A header you are debugging gets switched off and on
 * repeatedly; deleting and retyping it loses the value. `Pair.disabled` preserves the row while
 * every send path omits it.
 *
 * Two view-only conveniences operate on the same in-memory pairs: a bulk-edit mode that flips the
 * grid into one `name: value` textarea (lossless round-trip through
 * `pairsToText`/`textToPairs`), and, when an environment is passed, a `{{variable}}` completion
 * popover over the value inputs. There is always one empty trailing row that materialises into a
 * real one when you type, so there is no separate Add button.
 */

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { List, Rows3, Trash2 } from 'lucide-react'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { Checkbox } from '@localixai/kit/checkbox'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import {
  Autocomplete,
  AutocompleteAnchor,
  AutocompleteList,
  AutocompleteOption,
} from '@localixai/kit/autocomplete'
import { ResultCountStatus } from '@localixai/mini-app-sdk/ui/result-count-status'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EditorCompletionItem } from '@localixai/kit/code-editor'
import type { Pair } from '../../backend/request-spec'
import type { EnvVariable } from '../../backend/contracts'
import { pairsToText, textToPairs } from '../model/pairBulk'
import { variableCompletions } from '../model/bodyEditor'
import { SecretField } from './SecretField'
import { Button } from '@localixai/kit/button'

type Menu = { index: number; items: EditorCompletionItem[]; active: number }

export function PairEditor({
  label,
  showLabel = false,
  labelMeta,
  readOnlyNames = false,
  showCheckbox = true,
  showDelete = true,
  showEmptyRow = true,
  allowBulkEdit = true,
  pairs,
  onChange,
  namePlaceholder = 'name',
  valuePlaceholder = 'value',
  variables,
  secretValues = false,
}: {
  /** Names the group for screen readers, and heads it visually only when `showLabel`. */
  label: string
  /**
   * Whether to print the group's name above it.
   *
   * OFF by default, because a tab that shows ONE grid does not need a heading repeating the tab
   * it is already inside — "PARAMS ▸ QUERY" is one of those two words too many, and it is the
   * noise when column captions already identify the grid. Turned on only where a pane genuinely
   * stacks two grids (Params, when the url has `:path` placeholders), which is the case where a
   * reader must be told which is which.
   */
  showLabel?: boolean
  /** Quiet provenance beside the label, e.g. path rows are derived from the URL. */
  labelMeta?: ReactNode
  /** Path placeholder names belong to the URL and therefore are not editable here. */
  readOnlyNames?: boolean
  showCheckbox?: boolean
  showDelete?: boolean
  showEmptyRow?: boolean
  allowBulkEdit?: boolean
  pairs: Pair[]
  onChange: (next: Pair[]) => void
  namePlaceholder?: string
  valuePlaceholder?: string
  /** Active-environment variables. When present, value inputs offer `{{var}}` completions. */
  variables?: ReadonlyArray<EnvVariable>
  /** Environment-secret mode: values are native-vault references and bulk text is unavailable. */
  secretValues?: boolean
}) {
  const [bulk, setBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const completionId = useId()
  // The value input the caret currently sits in — the anchor a completion inserts into.
  const activeInput = useRef<HTMLInputElement | null>(null)

  const patch = (i: number, next: Partial<Pair>) =>
    onChange(pairs.map((p, at) => (at === i ? { ...p, ...next } : p)))

  // A row index equal to `pairs.length` is the trailing empty row: writing to it appends a real
  // pair, which is what "materialises on type" means. Every write funnels through these two so the
  // virtual/real distinction lives in one place.
  const setName = (i: number, value: string) =>
    i === pairs.length
      ? onChange([...pairs, { name: value, value: '', ...(secretValues ? { secret: true } : {}) }])
      : patch(i, { name: value })
  const setValue = (i: number, value: string) =>
    i === pairs.length
      ? onChange([...pairs, { name: '', value, ...(secretValues ? { secret: true } : {}) }])
      : patch(i, { value })

  const enterBulk = () => {
    setBulkText(pairsToText(pairs))
    setMenu(null)
    setBulk(true)
  }

  // Recompute the completion popover from whatever the input holds right now (native value is
  // already current inside the event). Empty result closes it.
  const refreshMenu = (i: number, el: HTMLInputElement) => {
    if (!variables || variables.length === 0) return setMenu(null)
    const items = variableCompletions(el.value, el.selectionStart ?? el.value.length, variables)
    setMenu(items.length > 0 ? { index: i, items, active: 0 } : null)
  }

  // Replace the `[\w$]*` word before the caret with the completion's insert text, then restore the
  // caret just past it — the same edit the code editor makes, done by hand for a single-line input.
  const accept = (item: EditorCompletionItem) => {
    const el = activeInput.current
    if (!el || !menu) return setMenu(null)
    const caret = el.selectionStart ?? el.value.length
    const before = el.value.slice(0, caret)
    const word = before.match(/[\w$]*$/)?.[0] ?? ''
    const head = before.slice(0, before.length - word.length) + (item.insertText ?? item.label)
    const next = head + el.value.slice(caret)
    setValue(menu.index, next)
    setMenu(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(head.length, head.length)
    })
  }

  const onValueKeyDown = (e: KeyboardEvent, i: number) => {
    if (!menu || menu.index !== i) return
    const n = menu.items.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMenu({ ...menu, active: (menu.active + 1) % n })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMenu({ ...menu, active: (menu.active - 1 + n) % n })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      accept(menu.items[menu.active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMenu(null)
    }
  }

  if (bulk) {
    return (
      <div className="px-3 py-1.5">
        <div className="flex h-7 items-center justify-between gap-2">
          {showLabel ? (
            <div className="flex min-w-0 items-baseline gap-1.5">
              <SectionLabel>{label}</SectionLabel>
              {labelMeta && <span className="text-2xs text-text-faint">{labelMeta}</span>}
            </div>
          ) : (
            <span />
          )}
          <IconButton
            size="sm"
            aria-label={`Table view for ${label}`}
            aria-pressed
            tooltip="Table view"
            onClick={() => setBulk(false)}
          >
            <Rows3 className="size-3.5" />
          </IconButton>
        </div>
        <Textarea
          className="min-h-24 font-mono"
          value={bulkText}
          spellCheck={false}
          placeholder={`${namePlaceholder}: ${valuePlaceholder}`}
          onChange={(e) => {
            setBulkText(e.target.value)
            onChange(textToPairs(e.target.value))
          }}
          aria-label={`${label}, one per line`}
        />
        <p className="pt-1 text-2xs text-text-faint">
          One per line as name: value. Prefix a line with # to disable it.
        </p>
      </div>
    )
  }

  // The visible rows are the real pairs plus one trailing empty row (index === pairs.length).
  const rowCount = pairs.length + (showEmptyRow ? 1 : 0)

  return (
    <div className="group/pairs px-3 py-1.5">
      {showLabel && (
        <div className="flex h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <SectionLabel>{label}</SectionLabel>
            {labelMeta && <span className="flex items-center text-text-faint">{labelMeta}</span>}
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-sm border border-border-soft">
        <div className="grid h-7 grid-cols-[28px_minmax(112px,36%)_minmax(0,1fr)_30px] items-center border-b border-border-soft bg-foreground/[0.04] text-2xs font-medium text-text-faint">
          <span aria-hidden="true" />
          <span className="px-2">Name</span>
          <span className="border-l border-border-soft px-2">Value</span>
          <span aria-hidden="true" />
        </div>
        {Array.from({ length: rowCount }, (_, i) => {
          const virtual = i === pairs.length
          const pair: Pair = virtual ? { name: '', value: '' } : pairs[i]
          const activeMenu = menu?.index === i ? menu : null
          const menuOpen = activeMenu !== null
          const listId = `${completionId}-variables-${i}`
          const activeOptionId = activeMenu ? `${listId}-option-${activeMenu.active}` : undefined
          return (
            // Index-keyed on purpose: rows have no id, and keying by name would remount the input
            // on every keystroke — the field would lose focus as you typed its name. The trailing
            // row keeping its index is also what lets focus survive materialisation.
            <div
              key={i}
              className={cn(
                'group/row grid min-h-8 grid-cols-[28px_minmax(112px,36%)_minmax(0,1fr)_30px] items-center border-t border-border-soft first:border-t-0 hover:bg-surface-hover/35 focus-within:bg-surface-hover/35',
                !virtual && pair.disabled && 'text-text-faint',
              )}
            >
              <span className="flex items-center justify-center">
                {virtual ? (
                  <span className="size-3.5" aria-hidden="true" />
                ) : showCheckbox ? (
                  <Checkbox
                    className="size-3.5"
                    checked={!pair.disabled}
                    onChange={(e) => patch(i, { disabled: !e.target.checked })}
                    aria-label={`Send ${pair.name || 'this row'}`}
                    title={pair.disabled ? 'Not sent' : 'Sent'}
                  />
                ) : (
                  <span className="size-3.5" aria-hidden="true" />
                )}
              </span>
              <Input
                size="lg"
                className="rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-ring"
                value={pair.name}
                readOnly={readOnlyNames}
                placeholder={virtual ? 'Add name' : namePlaceholder}
                onChange={(e) => setName(i, e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (!text.includes('\n')) return
                  // A multi-line paste is a block of pairs — expand it in place of this row
                  // rather than dropping the whole blob into one name field.
                  e.preventDefault()
                  onChange([...pairs.slice(0, i), ...textToPairs(text), ...pairs.slice(i + 1)])
                }}
                aria-label={`${label} name`}
              />
              <div className="min-w-0 border-l border-border-soft">
                {secretValues ? (
                  <SecretField
                    ariaLabel={`${label} value`}
                    value={pair.value}
                    onChange={(value) => setValue(i, value)}
                    placeholder={virtual ? 'Add Vault secret' : 'Enter a value or pick from Vault'}
                    embedded
                  />
                ) : (
                  <Autocomplete
                    open={menuOpen}
                    onOpenChange={(open) => {
                      if (!open && menu?.index === i) setMenu(null)
                    }}
                  >
                    <AutocompleteAnchor asChild>
                      <Input
                        size="lg"
                        className="w-full rounded-none border-0 bg-transparent text-xs shadow-none focus-ring"
                        value={pair.value}
                        placeholder={virtual ? 'Add value' : valuePlaceholder}
                        onChange={(e) => {
                          setValue(i, e.target.value)
                          refreshMenu(i, e.currentTarget)
                        }}
                        onFocus={(e) => {
                          activeInput.current = e.currentTarget
                        }}
                        onClick={(e) => refreshMenu(i, e.currentTarget)}
                        onKeyUp={(e) => {
                          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')
                            refreshMenu(i, e.currentTarget)
                        }}
                        onKeyDown={(e) => onValueKeyDown(e, i)}
                        aria-label={`${label} value`}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-haspopup="listbox"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? listId : undefined}
                        aria-activedescendant={activeOptionId}
                      />
                    </AutocompleteAnchor>
                    {activeMenu && (
                      <>
                        <ResultCountStatus
                          count={activeMenu.items.length}
                          singular="suggestion"
                          plural="suggestions"
                        />
                        <AutocompleteList
                          id={listId}
                          aria-label={`${label} variable suggestions`}
                          className="max-h-[min(12rem,var(--radix-popover-content-available-height))]"
                        >
                          {activeMenu.items.map((item, at) => (
                            <AutocompleteOption
                              key={item.label}
                              id={`${listId}-option-${at}`}
                              active={at === activeMenu.active}
                              onMouseEnter={() => setMenu({ ...activeMenu, active: at })}
                              onClick={() => accept(item)}
                              className="justify-between"
                            >
                              <span className="truncate font-mono text-foreground">
                                {item.label}
                              </span>
                              {item.detail && (
                                <span className="truncate text-2xs text-text-faint">
                                  {item.detail}
                                </span>
                              )}
                            </AutocompleteOption>
                          ))}
                        </AutocompleteList>
                      </>
                    )}
                  </Autocomplete>
                )}
              </div>
              <IconButton
                aria-label={`Remove ${pair.name || 'row'}`}
                tooltip="Remove row"
                tone="danger"
                size="xs"
                className={cn(
                  virtual || !showDelete
                    ? 'invisible'
                    : 'opacity-45 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100',
                )}
                disabled={virtual || !showDelete}
                onClick={() => onChange(pairs.filter((_, at) => at !== i))}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          )
        })}
      </div>
      {allowBulkEdit && !secretValues && (
        <div className="flex h-8 items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-2xs text-status-info"
            onClick={enterBulk}
          >
            <List className="size-3" />
            Bulk edit
          </Button>
        </div>
      )}
    </div>
  )
}
