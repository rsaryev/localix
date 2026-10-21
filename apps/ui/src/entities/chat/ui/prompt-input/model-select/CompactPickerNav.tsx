import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/** One switcher: what it shows closed, and the column it opens (told how to close itself). */
export interface CompactPickerNavEntry {
  label: string
  /** Accessible name of the trigger: what is being switched. */
  ariaLabel: string
  render: (close: () => void) => ReactNode
}

/**
 * The narrow layout's way to the workload and provider columns: `Localix ⌄ / OpenAI ⌄` in the
 * model panel's header, each opening that column in a sheet.
 *
 * WHY. Below md the drawer used to stack every column as a horizontal strip — workload cards,
 * a provider search band, provider chips, then the model header and its search — five bands
 * before the first model, with cards clipped mid-word. Two switchers in a header the panel
 * already has bring the list up to the second band, and each column keeps its full vertical
 * shape (switches, groups, search) inside its sheet instead of being squeezed into a strip.
 *
 * `modal`: while a sheet is open the list beneath must not take hover or clicks — a stray
 * click there would pick a model on the way to closing the sheet.
 */
export function CompactPickerNav({
  workload,
  provider,
}: {
  workload?: CompactPickerNavEntry
  provider: CompactPickerNavEntry
}) {
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      {workload && (
        <>
          <NavSwitcher entry={workload} className="max-w-[45%]" />
          <span aria-hidden="true" className="shrink-0 text-xs text-text-faint">
            /
          </span>
        </>
      )}
      <NavSwitcher entry={provider} className="min-w-0 flex-1" />
    </span>
  )
}

function NavSwitcher({ entry, className }: { entry: CompactPickerNavEntry; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${entry.ariaLabel}: ${entry.label}`}
          className={cn(
            // `-ml-1.5` puts the first switcher's TEXT on the header gutter, where the title it
            // replaces would start; its hover fill reaches into the gutter instead.
            'first:-ml-1.5 inline-flex h-(--chrome-control-md) min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-surface-hover focus-ring aria-expanded:bg-surface-active',
            className,
          )}
        >
          <span className="min-w-0 truncate">{entry.label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(30rem,70dvh)] w-[min(20rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
      >
        {/* The sheet sits inside the picker's cmdk root in the component tree, so a key
            pressed here would bubble to it — Enter on a provider row would pick a model. */}
        <div
          role="presentation"
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => event.stopPropagation()}
        >
          {entry.render(() => setOpen(false))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
