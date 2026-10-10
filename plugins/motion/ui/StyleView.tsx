import { lazy, Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { MotionStyle } from '../shared/styles'
import { SIZE, directionFilmUrl } from './StyleGallery'

const FilmPlayer = lazy(() =>
  import('./FilmPlayer').then((module) => ({ default: module.FilmPlayer })),
)

/**
 * A direction's sample film, played large. "Use direction" forks it into this conversation's
 * workspace and opens the new film; its story is then rewritten in chat.
 */
export function StyleView({
  style,
  creating,
  onBack,
  onUse,
}: {
  style: MotionStyle
  creating: boolean
  onBack: () => void
  onUse: () => void
}) {
  const [width, height] = SIZE[style.format]
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <WorkbenchToolbar as="header" aria-label="Direction preview" className="justify-between">
        <WorkbenchToolbarSection className="min-w-0">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            Back to directions
          </Button>
          <h1 className="truncate text-sm font-medium text-foreground">{style.name}</h1>
        </WorkbenchToolbarSection>
        <Button size="sm" variant="ghost" disabled={creating} onClick={onUse}>
          {creating ? 'Creating…' : 'Use direction'}
        </Button>
      </WorkbenchToolbar>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 py-4 @2xl:px-6">
        <p className="text-xs text-text-soft">{style.description}</p>
        <div className="mx-auto w-full" style={{ maxWidth: `calc(70dvh * ${width / height})` }}>
          <Suspense fallback={<LoadingHint className="min-h-64">Loading the film…</LoadingHint>}>
            <FilmPlayer
              src={directionFilmUrl(style.id)}
              width={width}
              height={height}
              label={`${style.name} sample film`}
              autoplay
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
