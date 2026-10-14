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
import type { SpaceDocument } from '../../shared/format/document'
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
 */
export function FindDialog({
  space,
  open,
  onOpenChange,
  onPick,
}: {
  space: SpaceDocument
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchElements(space, spaceTypes, query), [query, space])
  const close = (next: boolean) => {
    if (!next) setQuery('')
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
                  <MatchedText text={result.text} query={query} />
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
