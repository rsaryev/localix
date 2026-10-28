import { Button } from '@localixai/kit/button'
import { Download, Hammer } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { cn } from '../lib/cn'
import { DOWNLOADS, resolveDownloads, type DownloadOption } from './downloadOptions'
import {
  detectDownload,
  readMacChipSignals,
  readPlatformSignals,
  type DownloadGuess,
  type PlatformId,
} from './downloadPlatform'

export { resolveDownloads }

const noSubscription = () => () => {}
/** The synchronous guess as a string, so the snapshot compares by value and never loops. */
const readFirstGuess = () => {
  const guess = detectDownload(readPlatformSignals())
  return `${guess.id}:${guess.certain}`
}
const SERVER_GUESS = 'unknown:false'

/**
 * SSR and the hydrating client render use the same source-build action; the browser's own
 * signals take over right after, and an uncertain Mac is refined once its chip is read.
 */
function useDownloadGuess(): DownloadGuess {
  const first = useSyncExternalStore(noSubscription, readFirstGuess, () => SERVER_GUESS)
  const [refined, setRefined] = useState<DownloadGuess | null>(null)
  useEffect(() => {
    const base = readPlatformSignals()
    const guess = detectDownload(base)
    if (guess.certain || guess.id !== 'mac-arm64') return
    let cancelled = false
    void readMacChipSignals().then((chip) => {
      if (!cancelled) setRefined(detectDownload({ ...base, ...chip }))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return useMemo(() => {
    if (refined) return refined
    const [id, certain] = first.split(':')
    return { id: id as PlatformId, certain: certain === 'true' }
  }, [first, refined])
}

const SOURCE_DOCS = '/docs/getting-started--installation#how-it-works'
const actionClasses = 'min-h-11 w-full justify-start gap-3 px-3 py-2 text-sm whitespace-normal'

function DownloadAction({ option }: { option: DownloadOption }) {
  const content = (
    <>
      <Download />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left">
        <span className="font-heading font-medium">{option.action}</span>
        <span className={cn('text-xs', option.url ? 'text-background/60' : 'text-text-faint')}>
          {option.url
            ? `${option.artifact}${option.experimental ? ' · Experimental' : ''}`
            : `${option.artifact} · Coming soon`}
        </span>
      </span>
    </>
  )

  return option.url ? (
    <Button asChild variant="mono" size="xl" className={actionClasses}>
      <a href={option.url}>{content}</a>
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="xl"
      disabled
      className={cn(actionClasses, 'text-text-soft disabled:opacity-100')}
    >
      {content}
    </Button>
  )
}

/** One platform action; uncertain or unsupported devices get the source-build guide. */
export function DownloadChooser({
  className,
  downloads = DOWNLOADS,
  id = 'downloads',
}: {
  className?: string
  downloads?: DownloadOption[]
  /** The in-page `#downloads` target; a second chooser on the page passes `null`. */
  id?: string | null
}) {
  const guess = useDownloadGuess()
  const primary = guess.certain ? downloads.find(({ id }) => id === guess.id) : undefined

  return (
    <div id={id ?? undefined} className={cn('w-full', className)}>
      {primary ? (
        <DownloadAction option={primary} />
      ) : (
        <Button asChild variant="ghost" size="xl" className={actionClasses}>
          <Link to={SOURCE_DOCS}>
            <Hammer />
            <span className="font-heading font-medium">Build from source</span>
          </Link>
        </Button>
      )}
    </div>
  )
}
