import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchFilterBar } from '@localixai/kit/workbench-filter-bar'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import type { CommitFilterState } from '../model/useCommitFilter'

/** One labelled text field in the commit-filter popover (author / path). */
function FilterField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-2xs text-text-faint">
      {label}
      <Input
        size="md"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        // No fill override and no hand-rolled chrome: `Input` already carries the field veil, the
        // control height and the focus recipe. A bare element here re-spelled all three and
        // drifted from every other field in the app.
      />
    </label>
  )
}

/** The sticky filter bar over the commit graph: message search + an author/path popover. */
export function CommitFilterBar({ filter }: { filter: CommitFilterState }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  return (
    // `/95`, not plain `bg-background`: under glass the nested ground coat is cleared by the
    // paint-the-ground-once rule, so this sticky bar went transparent and rows scrolled through it.
    <WorkbenchFilterBar
      aria-label="Commit filters"
      density="compact"
      className="lx-occluder sticky top-0 z-(--z-sticky)"
    >
      <SearchInput
        size="md"
        inset
        value={filter.query}
        onValueChange={filter.setQuery}
        placeholder="Filter commits…"
        aria-label="Filter commits by message"
        className="w-full"
      />
      <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
        <PopoverTrigger asChild>
          <IconButton
            size="md"
            aria-label="Author and path filters"
            tooltip="Author & path filters"
            className={cn(
              'justify-self-end border',
              filter.advancedActive && 'border-control-border-focus text-foreground',
            )}
          >
            <SlidersHorizontal className="size-3.5" />
          </IconButton>
        </PopoverTrigger>
        {/* A popover that declares a header owes the structured layout its one scrolling body —
            otherwise the header scrolls away with the content it is supposed to pin. */}
        <PopoverContent layout="structured" align="end" className="w-64">
          <PopoverHeader>
            <PopoverTitle>Filter commits</PopoverTitle>
          </PopoverHeader>
          <PopoverBody className="gap-3">
            <FilterField
              label="Author"
              value={filter.author}
              placeholder="name or email…"
              onChange={filter.setAuthor}
            />
            <FilterField
              label="Path"
              value={filter.path}
              placeholder="src/app.ts…"
              onChange={filter.setPath}
            />
            {filter.hasFilter && (
              <Button
                variant="link"
                size="xs"
                onClick={() => {
                  filter.clear()
                  setFiltersOpen(false)
                }}
                className="self-start px-0 text-text-faint hover:text-foreground"
              >
                Clear all filters
              </Button>
            )}
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </WorkbenchFilterBar>
  )
}
