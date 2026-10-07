import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@localixai/kit/dialog'
import { homeShots } from '../generated/home-shots'
import { ProductShot } from './ProductShot'

/** A readable, keyboard-accessible viewer for the single captures beside section copy. */
export function ExpandableProductShot({
  shot,
  alt,
  title,
}: {
  shot: string
  alt: string
  title: string
}) {
  const [open, setOpen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const zoomPoint = useRef({ x: 0.5, y: 0.5 })
  const entry = homeShots[shot]

  useLayoutEffect(() => {
    const stage = viewport.current
    if (!stage) return
    stage.scrollLeft = zoomed ? (stage.scrollWidth - stage.clientWidth) * zoomPoint.current.x : 0
    stage.scrollTop = zoomed ? (stage.scrollHeight - stage.clientHeight) * zoomPoint.current.y : 0
  }, [zoomed])

  if (!entry || entry.placeholder) return <ProductShot shot={shot} alt={alt} />

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setZoomed(false)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="screenshot-trigger"
          aria-label={`Enlarge screenshot: ${title}`}
        >
          <ProductShot shot={shot} alt={alt} className="screenshot-thumbnail border-0" />
        </Button>
      </DialogTrigger>
      <DialogContent
        size="fit"
        layout="edge-to-edge"
        appearance="media"
        className="screenshot-dialog overflow-visible"
      >
        <div className="screenshot-viewer" data-zoomed={zoomed}>
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {alt}. Click the image to zoom. Scroll to explore the enlarged image. Press Escape to
            close.
          </DialogDescription>
          <div
            ref={viewport}
            className="screenshot-viewport"
            role="region"
            aria-label="Screenshot viewer"
          >
            <Button
              variant="ghost"
              className="screenshot-image-button"
              data-zoomed={zoomed}
              aria-pressed={zoomed}
              aria-label={zoomed ? 'Fit screenshot to window' : 'Zoom into screenshot'}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                zoomPoint.current = event.detail
                  ? {
                      x: (event.clientX - bounds.left) / bounds.width,
                      y: (event.clientY - bounds.top) / bounds.height,
                    }
                  : { x: 0.5, y: 0.5 }
                setZoomed(!zoomed)
              }}
            >
              <img
                src={entry.src}
                alt={alt}
                width={1600}
                height={1000}
                draggable={false}
                className="screenshot-full-image"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
