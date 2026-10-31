import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { HINT, useDismissable } from '../lib/dismissable'
import { formatChordText, formatModifierText } from '../keyboard/chord'
import { ActionTooltip } from '../overlays/action-tooltip'
import { POPOVER_MATERIAL } from '../overlays/popover-surface'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '../controls/button'
import { IconButton } from '../controls/icon-button'
import { gestureHint, type CanvasInteraction } from './keyboard'
import { useStore } from '@xyflow/react'
import { useCanvasCamera } from './useCanvasCamera'

/**
 * The zoom and the camera's actions, bottom right, on every board; and, the first time only, a
 * one-line reminder of the gestures. The scheme is the design tools', but a person arriving from a
 * map app expects the wheel to zoom and should not have to discover otherwise by accident. The
 * reminder is dismissed once for every board, because there is one scheme to learn.
 *
 * The percentage is a button: 100% is the zoom a person most often wants back. Both carry
 * `data-canvas-chrome`, the mark a board's own mode (a presentation) hides its chrome by.
 */
export function CanvasControls({
  interaction,
  showHint = true,
}: {
  interaction: CanvasInteraction
  showHint?: boolean
}) {
  const camera = useCanvasCamera()
  const hint = useDismissable(HINT.canvasGestures)
  const chord = (value: string) => formatChordText(value)
  // The rounded percent, not the zoom: a camera flight changes the zoom every frame, and the
  // toolbar redraws only when the number it shows changes.
  const percent = useStore((state) => Math.round(state.transform[2] * 100))
  return (
    <>
      {showHint && !hint.dismissed && (
        <div
          data-canvas-chrome=""
          className={cn(
            POPOVER_MATERIAL,
            'absolute bottom-3 left-3 z-(--z-controls) flex items-center gap-2 rounded-lg border border-border-soft py-1 pl-3 pr-1 text-2xs text-text-soft',
          )}
        >
          <span>{gestureHint(interaction, formatModifierText('mod'))}</span>
          <IconButton aria-label="Dismiss the hint" size="xs" onClick={hint.dismiss}>
            <X className="size-3" />
          </IconButton>
        </div>
      )}
      <div
        data-canvas-chrome=""
        className={cn(
          POPOVER_MATERIAL,
          'absolute bottom-3 right-3 z-(--z-controls) flex items-center gap-0.5 rounded-lg border border-border-soft p-0.5',
        )}
      >
        <IconButton
          aria-label="Zoom out"
          tooltip="Zoom out (−)"
          size="sm"
          onClick={() => camera.zoom(-1)}
        >
          <Minus className="size-3.5" />
        </IconButton>
        <ActionTooltip label={`Zoom to 100% (${chord('shift+0')})`}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Zoom ${percent}%, reset to 100%`}
            onClick={() => camera.actualSize()}
            className="w-11 px-0 font-mono text-3xs text-text-faint tabular-nums"
          >
            {percent}%
          </Button>
        </ActionTooltip>
        <IconButton
          aria-label="Zoom in"
          tooltip="Zoom in (+)"
          size="sm"
          onClick={() => camera.zoom(1)}
        >
          <Plus className="size-3.5" />
        </IconButton>
        <IconButton
          aria-label="Fit everything"
          tooltip={`Fit everything (${chord('shift+1')})`}
          size="sm"
          onClick={() => camera.fit()}
        >
          <Maximize2 className="size-3.5" />
        </IconButton>
      </div>
    </>
  )
}
