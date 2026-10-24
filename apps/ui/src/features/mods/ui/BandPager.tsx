import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { CMD, useChordHint } from '@/shared/lib/keybindings'

/**
 * The band's pager, at the end of its first row: ‹ 1/2 › as quiet ghost controls, with the mods
 * that drew the page as a muted label where the band has room, and always in the tooltip.
 */
export function BandPager({
  index,
  count,
  mods,
  step,
}: {
  index: number
  count: number
  /** The mods that drew the page showing. */
  mods: readonly string[]
  step: (by: number) => void
}) {
  const hint = useChordHint()
  const position = `Mod band page ${index + 1} of ${count}`
  const names = mods.join(' · ')
  return (
    <div role="group" aria-label={position} className="flex min-w-0 items-center">
      <IconButton
        size="xs"
        aria-label="Previous mod band page"
        tooltip={hint('Previous page', CMD.modBandPrevPage)}
        onClick={() => step(-1)}
      >
        <ChevronLeft />
      </IconButton>
      <ActionTooltip label={names ? `${position}: ${names}` : position}>
        <span
          className="flex min-w-0 items-center gap-1.5 px-0.5 text-2xs text-text-faint tabular-nums"
          // Read once by the group's name; the tooltip says it whole.
          aria-hidden="true"
        >
          <span className="shrink-0">
            {index + 1}/{count}
          </span>
          {names && <span className="hidden max-w-32 truncate @md:inline">{names}</span>}
        </span>
      </ActionTooltip>
      <IconButton
        size="xs"
        aria-label="Next mod band page"
        tooltip={hint('Next page', CMD.modBandNextPage)}
        onClick={() => step(1)}
      >
        <ChevronRight />
      </IconButton>
    </div>
  )
}
