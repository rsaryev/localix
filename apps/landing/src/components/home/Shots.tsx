import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './shots.css'

/**
 * A homepage capture: the whole window, 16:10, made by `scripts/screenshots/landing.mjs` into
 * `public/landing/<name>.webp`.
 */
export interface Capture {
  name: string
  alt: string
}

/** The published size of every capture, so each panel holds its place before the picture loads. */
const WIDTH = 1600
const HEIGHT = 1000

function Picture({ capture, lazy }: { capture: Capture; lazy?: boolean }) {
  return (
    <img
      src={`/landing/${capture.name}.webp`}
      alt={capture.alt}
      width={WIDTH}
      height={HEIGHT}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
    />
  )
}

/** The capture of a card, edge to edge; a click opens it larger, over the page, until Escape. */
export function Shot({ capture }: { capture: Capture }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener.current?.focus()
    }
  }, [open])
  return (
    <>
      <button
        type="button"
        className="shot-open"
        aria-label={`Enlarge: ${capture.alt}`}
        onClick={(event) => {
          opener.current = event.currentTarget
          setOpen(true)
        }}
      >
        <Picture capture={capture} lazy />
      </button>
      {open
        ? createPortal(
            <div className="shot-lightbox" role="dialog" aria-modal="true" aria-label={capture.alt}>
              <button
                type="button"
                className="shot-backdrop"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setOpen(false)}
              />
              <div className="shot-big">
                <Picture capture={capture} />
              </div>
              <button
                ref={close}
                type="button"
                className="shot-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X />
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
