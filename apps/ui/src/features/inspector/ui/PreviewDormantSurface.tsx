import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { PreviewFrame } from '../model/previewLastFrame'

/**
 * What a preview pane shows once its page is gone — dead server, a frame that never
 * loaded, a site that refuses embedding.
 *
 * It paints NOTHING of its own by default: the pane's ground is already the right material,
 * and a surface of its own made the preview a bright slab in the light theme, brighter than
 * every panel around it. A ground is painted only to `occlude` — when a loaded iframe is
 * still mounted underneath, whose white fill outlives the document and turns any scrim over
 * it into a flat grey slab. That is what `bg-background-solid` is for (the documented
 * occluder idiom: under the glass theme a plain `bg-background` would leak the white
 * through), and it is the exception, not the resting state.
 *
 * With a last frame it shows the page as it last was, blurred and pushed back — the same
 * move a disconnected terminal makes by keeping its scrollback behind the notice, so the
 * pane reads as "your thing, paused" rather than as an empty rectangle. Purely decorative:
 * `aria-hidden`, no pointer events; the words and the recovery action live in the notice.
 */
export function PreviewDormantSurface({
  frame,
  occlude = false,
}: {
  frame?: PreviewFrame | null
  /** A live iframe is mounted behind this — hide it, rather than tinting it. */
  occlude?: boolean
}) {
  return (
    <div
      aria-hidden
      data-slot="preview-dormant-surface"
      data-ghost={frame ? 'frame' : 'empty'}
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        occlude && 'bg-background-solid',
      )}
    >
      {frame && (
        <>
          {/* Anchored to the top and slightly overscaled: a page reads from its header
              down, and the scale keeps the blur from feathering the pane's own edges. */}
          <img
            src={frame.src}
            alt=""
            draggable={false}
            className="size-full scale-[1.04] object-cover object-top opacity-30 blur-[3px] saturate-[0.55]"
          />
          {/* Sunk under the app's ground so the ghost never competes with the notice. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in oklch, var(--background), transparent 45%), color-mix(in oklch, var(--background), transparent 72%) 42%, color-mix(in oklch, var(--background), transparent 25%))',
            }}
          />
        </>
      )}
    </div>
  )
}
