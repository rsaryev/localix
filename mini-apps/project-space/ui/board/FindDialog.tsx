import { useMemo, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@localixai/kit/command'
import { MatchedText } from '@localixai/kit/matched-text'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import type { SpaceOp } from '../../shared/ops/contract'
import { replaceOps } from '../../shared/ops/replace'
import type { SpaceDocument } from '../../shared/format/document'
import { elementName } from '../../shared/graph/names'
import { searchElements } from '../../shared/graph/search'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'

/**
 * `/` — find an element by what it says (a file's path, a note's words, a type) and go to it.
 *
 * The layers panel lists everything, but on a board of a hundred cards scrolling a list is not
 * finding. The ranking is the board's own (`shared/graph/search.ts`, which the agent's
 * `space_read { query }` uses too), so the palette does no filtering of its own; choosing a result
 * is a deliberate focus, flown by the board's one framing policy and undone with ⌥←.
 *
 * **Replace** swaps the phrase in the board's own words — notes, labels, titles, connector labels
 * (`shared/ops/replace.ts`) — in one write, so one undo takes every replacement back.
 */
export function FindDialog({
  space,
  open,
  onOpenChange,
  onPick,
  commit,
}: {
  space: SpaceDocument
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (id: string) => void
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const [query, setQuery] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replacement, setReplacement] = useState('')
  const found = useMemo(() => searchElements(space, spaceTypes, query), [query, space])
  const swap = useMemo(
    () => replaceOps(space, spaceTypes, query.trim(), replacement),
    [space, query, replacement],
  )
  const close = (next: boolean) => {
    if (!next) {
      setQuery('')
      setReplacing(false)
      setReplacement('')
    }
    onOpenChange(next)
  }
  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="Find on the board"
      description="Find an element by its text, file path or type"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Find a note, a file, a frame…"
        />
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5">
          {replacing ? (
            <>
              <Input
                aria-label="Replace with"
                placeholder="Replace with…"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                size="md"
                className="min-w-0 flex-1 text-xs"
              />
              <Button
                size="sm"
                variant="field"
                disabled={swap.count === 0}
                onClick={() => {
                  commit(swap.ops)
                  close(false)
                }}
              >
                Replace {swap.count || ''}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-2xs text-text-soft"
              onClick={() => setReplacing(true)}
            >
              Replace…
            </Button>
          )}
        </div>
        <CommandList>
          <CommandEmpty>Nothing on the board says that.</CommandEmpty>
          {found.map((result) => {
            const element = space.elements[result.id]
            const view = element ? viewOf(element.type) : undefined
            const label = element ? (spaceTypes.get(element.type)?.label ?? element.type) : ''
            return (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => {
                  close(false)
                  onPick(result.id)
                }}
              >
                {view && <view.Icon aria-hidden className="size-3.5 shrink-0 text-text-faint" />}
                <span className="min-w-0 flex-1 truncate">
                  {/* What it reads as, not how it is written: no `**` marks, no Mermaid. */}
                  <MatchedText
                    text={elementName(space, spaceTypes, result.id, 120)}
                    query={query}
                  />
                </span>
                <span className="shrink-0 text-3xs text-text-faint">{label}</span>
              </CommandItem>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
