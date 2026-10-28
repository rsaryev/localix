import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Download, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@localixai/kit/dialog'
import { MediaOverlayButton, mediaOverlayPillClasses } from '@localixai/kit/media-overlay-button'
import { copyImageToClipboard } from '@/shared/lib/copyImage'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { COPIED_FEEDBACK_LONG_MS } from '@/shared/lib/timings'
import { useCopiedFlag } from '@/shared/hooks/useCopiedFlag'

/**
 * Fullscreen image viewer — reuses the shared Dialog (Esc / overlay-click to close)
 * with a close ✕ and a download action pinned to the image's OWN corners (not the
 * dialog's), so they're always easy to find regardless of image size. Render once
 * and drive with a small piece of state:
 *   `<ImageLightbox image={zoom} onClose={() => setZoom(null)} />`
 * Shared by the message attachments and the composer attachment trays.
 *
 * Opt-in paging: pass `onPrev`/`onNext` (with `hasPrev`/`hasNext`) to add edge
 * chevrons + ←/→ arrow-key paging between the images one message carries. Callers
 * that omit them (composer trays) render a plain single-image viewer.
 */
export function ImageLightbox({
  image,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: {
  image: { src: string; name: string; kind?: 'image' | 'video' } | null
  onClose: () => void
  /** Opt-in prev/next paging. */
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}) {
  // BEFORE the `!image` early return: a hook may not sit behind a conditional,
  // and this component is rendered permanently with `image = null` while closed.
  const { copied, flash } = useCopiedFlag(COPIED_FEEDBACK_LONG_MS)
  const src = image?.src ?? null
  const copy = async () => {
    if (!src) return
    try {
      if (!(await copyImageToClipboard(src))) {
        toast.error('Could not copy this image', {
          description: 'This window is not allowed to write to the clipboard.',
        })
        return
      }
      flash()
    } catch (cause) {
      toast.error('Could not copy this image', {
        description: errorMessage(cause, 'The image could not be read.'),
      })
    }
  }

  if (!image) return null
  const isVideo = image.kind === 'video'
  const navigable = Boolean(onPrev || onNext)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        layout="edge-to-edge"
        showCloseButton={false}
        onKeyDown={
          navigable
            ? (e) => {
                if (e.key === 'ArrowLeft' && hasPrev) {
                  e.preventDefault()
                  onPrev?.()
                } else if (e.key === 'ArrowRight' && hasNext) {
                  e.preventDefault()
                  onNext?.()
                }
              }
            : undefined
        }
        size="fit"
        className="border-0 bg-transparent p-0 shadow-none ring-0"
      >
        <DialogTitle className="sr-only">{image.name}</DialogTitle>
        {/* Wrapper shrinks to the image, so the corner controls hug the picture. */}
        <div className="relative inline-block">
          {isVideo ? (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- a user's attachment carries no caption track to offer
            <video
              src={image.src}
              controls
              autoPlay
              className="block max-h-[86vh] w-auto max-w-[94vw] rounded-lg bg-black object-contain"
            />
          ) : (
            <img
              src={image.src}
              alt={image.name}
              className="block max-h-[86vh] w-auto max-w-[94vw] rounded-lg object-contain"
            />
          )}
          {navigable && (
            <>
              <MediaOverlayButton
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Previous"
                title="Previous (←)"
                size="xl"
                className="absolute left-2 top-1/2 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
              >
                <ChevronLeft className="size-5" />
              </MediaOverlayButton>
              <MediaOverlayButton
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Next"
                title="Next (→)"
                size="xl"
                className="absolute right-2 top-1/2 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
              >
                <ChevronRight className="size-5" />
              </MediaOverlayButton>
            </>
          )}
          <div className="absolute right-2 top-2 flex items-center gap-2">
            <MediaOverlayButton onClick={onClose} aria-label="Close" title="Close (Esc)" size="lg">
              <X className="size-4" />
            </MediaOverlayButton>
          </div>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {/* Copy the PICTURE. Without this the only way to copy an image here
                was to select it and press ⌘C, which for an inline attachment puts
                the `<img>`'s `data:image/png;base64,…` src on the clipboard as
                TEXT — pasting it elsewhere produced a wall of base64 instead of
                the image. Video has no clipboard equivalent, so it keeps
                download only. */}
            {!isVideo && (
              <button
                type="button"
                className={mediaOverlayPillClasses('cursor-pointer')}
                // `void`, not the bare async fn: an onClick handler is expected to
                // return nothing, and handing it a promise leaves any rejection
                // unhandled. `copy` reports its own failures, so there is nothing
                // for a caller to await.
                onClick={() => void copy()}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <a href={image.src} download={image.name} className={mediaOverlayPillClasses()}>
              <Download className="size-3.5" /> Download
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Paging state for one {@link ImageLightbox} over an ordered list of images: `open(index)` shows
 * one, and `lightbox` is spread onto the viewer so ←/→ walks the list and stops at both ends.
 */
export function useLightboxPaging<T extends { src: string; name: string }>(images: readonly T[]) {
  const [index, setIndex] = useState<number | null>(null)
  const hasPrev = index != null && index > 0
  const hasNext = index != null && index < images.length - 1
  return {
    open: setIndex,
    lightbox: {
      image: index != null ? (images[index] ?? null) : null,
      onClose: () => setIndex(null),
      onPrev: hasPrev ? () => setIndex(index - 1) : undefined,
      onNext: hasNext ? () => setIndex(index + 1) : undefined,
      hasPrev,
      hasNext,
    },
  }
}
