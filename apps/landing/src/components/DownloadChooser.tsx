import { Button } from '@localixai/kit/button'
import { Download, Hammer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '../lib/cn'
import { DOWNLOADS, resolveDownloads, type DownloadOption } from './downloadOptions'
import {
  detectDownload,
  readMacChipSignals,
  readPlatformSignals,
  type DownloadGuess,
} from './downloadPlatform'

export { resolveDownloads }

/** SSR and the first client render use the same source-build action. */
function useDownloadGuess(): DownloadGuess {
  const [guess, setGuess] = useState<DownloadGuess>({ id: 'unknown', certain: false })
  useEffect(() => {
    const base = readPlatformSignals()
    const first = detectDownload(base)
    setGuess(first)
    if (first.certain || first.id !== 'mac-arm64') return
    let cancelled = false
    void readMacChipSignals().then((chip) => {
      if (!cancelled) setGuess(detectDownload({ ...base, ...chip }))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return guess
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
