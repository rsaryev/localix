import { Check, Copy, Download, Maximize2 } from 'lucide-react'
import type { MessageAttachment } from '@/shared/api/contracts'
import { formatFileSize } from '@localixai/plugin-sdk/ui/utilities'
import { copyImageToClipboard } from '@/shared/lib/copyImage'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import { mediaOverlayClasses } from '@localixai/kit/media-overlay-button'
import { ContributedActions } from '@/shared/ui/ContributedActions'
import { COPIED_FEEDBACK_MS } from '@/shared/lib/timings'
import { useCopiedFlag } from '@/shared/hooks/useCopiedFlag'

/**
 * Inline figures for the image and video an assistant turn or a user message
 * carries. Every image in the transcript renders through here, whoever produced
 * it: two renders would let a pasted screenshot look worse than a tool's image.
 *
 * The image sizes itself: the box caps the LONG edge and the intrinsic aspect
 * does the rest, so nothing has to know the dimensions in advance. That matters
 * because no attachment carries them — a declared `1:1` box would letterbox
 * every non-square image.
 */

/** Cap on an inline figure's long edge; a portrait image stays readable beside text. */
const FIGURE_MAX_EDGE = '28rem'

const overlayBtn = mediaOverlayClasses({
  size: 'md',
  shape: 'square',
  className: 'cursor-pointer motion-reduce:transition-none',
})

/** Shared caption strip: a meta line + a Save download link. */
function MediaCaption({
  meta,
  fallback,
  src,
  name,
}: {
  meta: string
  fallback: string
  src: string
  name: string
}) {
  return (
    <figcaption className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-2xs text-text-faint">
      <span className="truncate">{meta || fallback}</span>
      <a
        href={src}
        download={name}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-text-soft transition hover:bg-foreground/5 hover:text-text-strong"
        title={`Download ${fallback === 'Video' ? 'video' : 'image'}`}
      >
        <Download className="size-3" /> Save
      </a>
    </figcaption>
  )
}

/**
 * Hover action row over an image: Copy · Save · Expand.
 */
function ImageActions({
  src,
  name,
  onExpand,
}: {
  src: string
  name: string
  onExpand: () => void
}) {
  const { copied, flash } = useCopiedFlag(COPIED_FEEDBACK_MS)

  const handleCopy = async () => {
    // A failed copy must not be indistinguishable from a click that did not register:
    // the helper returns false for a refused write and throws for a decode failure.
    try {
      if (await copyImageToClipboard(src)) {
        flash()
        return
      }
      toast.error('Could not copy this image', {
        description: 'The platform refused the write, or the image could not be re-encoded to PNG.',
      })
    } catch (err) {
      toast.error('Could not copy this image', {
        description: errorMessage(err, 'The image could not be read.'),
      })
    }
  }

  return (
    // `lx-media-actions` is not decoration: a coarse-pointer device has no hover,
    // and app/index.css keys the "show these anyway" override off this class.
    <div className="lx-media-actions pointer-events-none absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-(--dur-fast) group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      <ContributedActions
        className={overlayBtn}
        size="md"
        surface="chat.content"
        target={{ kind: 'image', src, alt: name }}
      />
      <button
        type="button"
        className={overlayBtn}
        onClick={(e) => {
          e.stopPropagation()
          void handleCopy()
        }}
        title={copied ? 'Copied' : 'Copy image'}
        aria-label="Copy image"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <a
        className={overlayBtn}
        href={src}
        download={name}
        onClick={(e) => e.stopPropagation()}
        title="Save image"
        aria-label="Save image"
      >
        <Download className="size-3.5" />
      </a>
      <button
        type="button"
        className={overlayBtn}
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
        title="Open full size"
        aria-label="Open full size"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  )
}

export function ImageFigure({
  att,
  grid,
  onZoom,
}: {
  att: MessageAttachment & { kind: 'image' }
  /** Two-up grid sizing when a message carries several images. */
  grid: boolean
  /** Open this image in the shared lightbox (paged by the parent). */
  onZoom: () => void
}) {
  const src = mediaSrc(att)
  const meta = formatFileSize(att.size)

  return (
    <figure
      className={`group relative overflow-hidden rounded-xl border border-control-border bg-surface-raised ${
        grid ? 'w-[calc(50%-0.25rem)] min-w-[10rem] max-w-xs' : 'w-fit'
      }`}
    >
      {/* A button, not a bare `<img onClick>`: opening the lightbox is the figure's
          primary action and it has to be reachable from the keyboard. */}
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Open ${att.name} full size`}
        className="block cursor-zoom-in outline-none focus-ring"
      >
        <img
          src={src}
          alt={att.name}
          title={att.name}
          loading="lazy"
          className="block max-h-(--media-max-edge) w-auto max-w-full object-contain transition hover:brightness-[0.97]"
          style={{ '--media-max-edge': FIGURE_MAX_EDGE } as React.CSSProperties}
        />
      </button>
      <ImageActions src={src} name={att.name} onExpand={onZoom} />
      <MediaCaption meta={meta} fallback="Image" src={src} name={att.name} />
    </figure>
  )
}

export function VideoFigure({ att }: { att: MessageAttachment & { kind: 'video' } }) {
  const src = mediaSrc(att)
  const meta = formatFileSize(att.size)
  return (
    <figure className="group relative w-fit overflow-hidden rounded-xl border border-control-border bg-surface-raised">
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        title={att.name}
        className="block max-h-(--media-max-edge) w-auto max-w-full bg-black object-contain"
        style={{ '--media-max-edge': FIGURE_MAX_EDGE } as React.CSSProperties}
      />
      <MediaCaption meta={meta} fallback="Video" src={src} name={att.name} />
    </figure>
  )
}
