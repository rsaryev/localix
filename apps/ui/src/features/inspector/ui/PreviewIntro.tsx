import { MousePointerClick } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'
import { Button } from '@localixai/kit/button'
import { PaneStateOverlay } from '@localixai/kit/pane-state-overlay'
import { POPOVER_SURFACE } from '@localixai/kit/popover-surface'

/**
 * One-time, minimalist intro shown the first time a user opens a preview. Offers
 * the two ways to use it — just browse, or Visual Feedback — with a one-line guide.
 * Dismissal is persisted by the caller, so it appears once. Escape dismisses it (as
 * "just browse").
 */
export function PreviewIntro({
  active = true,
  vfAvailable,
  onBrowse,
  onComment,
}: {
  active?: boolean
  vfAvailable: boolean
  onBrowse: () => void
  onComment: () => void
}) {
  // Escape dismisses the intro, but only while it is the surface that owns the keyboard: open a
  // dialog over the preview and Escape belongs to the dialog, with nothing here to check for it.
  useFocusEntry({
    id: 'preview-intro',
    kind: 'surface',
    active,
    onKeyDown: (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onBrowse()
      return true
    },
  })

  return (
    <PaneStateOverlay className="z-(--z-overlay)">
      {/* The floating-panel surface (`POPOVER_SURFACE`, frosted by the theme), not
          `bg-surface-raised`: raised mixes from a darker ground than the pane this card floats
          over, so the intro read as a black card on the dimmed preview. It used to transcribe
          the material and missed the rim ring and the frost marker the contrast rules key on. */}
      <div className={cn(POPOVER_SURFACE, 'w-[min(340px,100%)] p-4')}>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MousePointerClick className="size-4 text-status-success" aria-hidden />
          Live preview
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-text-soft">
          Browse it like a normal app — or turn on{' '}
          <b className="font-medium text-foreground">Visual Feedback</b>: click anything to leave a
          note, mapped back to source for the agent.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBrowse}>
            Just browse
          </Button>
          <Button type="button" variant="mono" size="sm" onClick={onComment}>
            Visual Feedback
          </Button>
        </div>
        {!vfAvailable && (
          <p className="mt-2 text-2xs text-text-faint">
            (Visual Feedback activates once the preview finishes loading.)
          </p>
        )}
      </div>
    </PaneStateOverlay>
  )
}
