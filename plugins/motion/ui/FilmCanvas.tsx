import { useMotionSessionId } from './scope'
import { useEffect, useRef, useState } from 'react'
import type { MotionDocument } from '../shared/schema'
import { dimensions } from '../shared/timing'
import { renderFrame } from '../shared/render'
import { loadImages } from './media'

export function FilmCanvas({
  document,
  frame,
  thumbnail = false,
}: {
  document: MotionDocument
  frame: number
  thumbnail?: boolean
}) {
  const sessionId = useMotionSessionId()
  const ref = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map())
  const [error, setError] = useState('')
  const imageKey = JSON.stringify(
    document.scenes.flatMap((scene) => [
      scene.imageId,
      ...scene.layers.map((layer) => layer.assetId),
    ]),
  )
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    loadImages(document, abort.signal, sessionId).then(
      (images) => {
        if (!abort.signal.aborted) setImages(images)
      },
      () => {
        if (!abort.signal.aborted)
          setError('An image could not be loaded. Reattach it before exporting.')
      },
    )
    return () => abort.abort()
    // Only asset identities affect decoded images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, sessionId])
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) renderFrame(ctx, document, frame, images)
  }, [document, frame, images])
  const size = dimensions(document.format, 720)
  return (
    <>
      <canvas
        ref={ref}
        {...size}
        aria-label={thumbnail ? `${document.title} preview` : 'Motion video preview'}
        role="img"
        className={
          thumbnail
            ? 'block h-auto w-full rounded-md'
            : 'block h-auto w-auto max-h-full max-w-full rounded-md'
        }
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {error}
        </p>
      )}
    </>
  )
}
