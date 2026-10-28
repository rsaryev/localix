import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import type { SpaceDocument } from '../../shared/format/document'
import { BarDivider, BarSurface } from './pickers'
import type { Presentation } from './usePresentation'

/**
 * The one control left while presenting: where the talk is, the way back and forth, the way out.
 * The arrows and Escape do the same from the keyboard (`boardKeys.ts`).
 */
export function PresentBar({
  presentation,
  space,
}: {
  presentation: Presentation
  space: SpaceDocument
}) {
  if (!presentation.active) return null
  const { index, frames } = presentation
  const frameTitle = frames[index] ? space.elements[frames[index]]?.props.title : undefined
  const title = typeof frameTitle === 'string' ? frameTitle : ''
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-(--z-controls) flex justify-center">
      <BarSurface label="Presentation" className="pointer-events-auto">
        <IconButton
          size="sm"
          aria-label="Previous frame"
          tooltip="Previous (←)"
          disabled={index === 0}
          onClick={() => presentation.go(index - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </IconButton>
        <span aria-live="polite" className="flex min-w-0 items-baseline gap-2 px-1.5 text-xs">
          <span className="tabular-nums text-text-soft">
            {index + 1} / {frames.length}
          </span>
          <span className="max-w-64 truncate font-medium">{title || 'Frame'}</span>
        </span>
        <IconButton
          size="sm"
          aria-label="Next frame"
          tooltip="Next (→)"
          disabled={index === frames.length - 1}
          onClick={() => presentation.go(index + 1)}
        >
          <ChevronRight className="size-3.5" />
        </IconButton>
        <BarDivider />
        <IconButton
          size="sm"
          aria-label="Stop presenting"
          tooltip="Stop presenting (Esc)"
          onClick={presentation.stop}
        >
          <X className="size-3.5" />
        </IconButton>
      </BarSurface>
    </div>
  )
}
