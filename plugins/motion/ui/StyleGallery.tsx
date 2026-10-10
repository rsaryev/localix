import { lazy, Suspense, useEffect, useState } from 'react'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { pluginApiUrl } from '@localixai/plugin-sdk/ui/transport'
import { motionStyles, type MotionStyle } from '../shared/styles'

const FilmPlayer = lazy(() =>
  import('./FilmPlayer').then((module) => ({ default: module.FilmPlayer })),
)
export const stylePreviewUrl = (id: string) => pluginApiUrl(`/rpc/motion/styles/${id}/preview.jpg`)
export const directionFilmUrl = (id: string) =>
  pluginApiUrl(`/rpc/motion/directions/${id}/index.html`)
export const SIZE = {
  landscape: [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080],
} as const

/** The directions: a still at each film's signature moment; hovering plays the film itself. */
export function StyleGallery({ onOpen }: { onOpen: (style: MotionStyle) => void }) {
  return (
    <section aria-label="Directions" className="space-y-3">
      <p className="text-xs text-text-soft">
        Each direction is a complete film. Preview one, use it, then rewrite the story with the
        agent.
      </p>
      <div
        role="group"
        aria-label="Motion directions"
        className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 @7xl:grid-cols-5"
      >
        {motionStyles.map((style) => (
          <DirectionTile key={style.id} style={style} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function DirectionTile({
  style,
  onOpen,
}: {
  style: MotionStyle
  onOpen: (style: MotionStyle) => void
}) {
  const [hover, setHover] = useState(false)
  const [playing, setPlaying] = useState(false)
  // A short intent delay: sweeping the pointer across the grid must not boot eleven films.
  useEffect(() => {
    if (!hover) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setPlaying(true), 350)
    return () => clearTimeout(timer)
  }, [hover])
  const [width, height] = SIZE[style.format]
  return (
    <SelectionTile
      selected={false}
      className="w-full min-w-0"
      aria-label={`${style.name} direction`}
      onClick={() => onOpen(style)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-foreground/[0.04]">
        <img
          src={stylePreviewUrl(style.id)}
          alt=""
          loading="lazy"
          onError={(event) => event.currentTarget.classList.add('invisible')}
          className="block h-full w-auto max-w-full rounded-sm object-contain"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
        {playing && (
          <div className="absolute inset-0 flex justify-center">
            <div className="relative h-full" style={{ aspectRatio: `${width} / ${height}` }}>
              <Suspense fallback={null}>
                <FilmPlayer
                  ambient
                  src={directionFilmUrl(style.id)}
                  width={width}
                  height={height}
                  label={`${style.name} sample`}
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <span className="mt-1.5 w-full truncate font-medium text-foreground">{style.name}</span>
      <span className="mt-0.5 flex w-full items-baseline justify-between gap-2">
        <span className="truncate text-2xs text-text-soft">{style.category}</span>
        <span className="text-2xs text-text-faint">
          {style.format === 'landscape' ? '16:9' : style.format === 'portrait' ? '9:16' : '1:1'}
        </span>
      </span>
    </SelectionTile>
  )
}
