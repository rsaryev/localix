import { BookOpen, ChevronDown, Download, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ButtonLink } from './Button'
import { GitHubMark } from './GitHubMark'
import { cn } from '../lib/cn'
import { DOWNLOADS, githubUrl, resolveDownloads, type DownloadOption } from './downloadOptions'
import {
  detectDownload,
  readMacChipSignals,
  readPlatformSignals,
  type DownloadGuess,
} from './downloadPlatform'

export { resolveDownloads }

/**
 * Which installer to lead with.
 *
 * The first render is the same for every visitor: this component is rendered to HTML at build
 * time and hydrated, and a guess read off `navigator` in the first render would make the browser's
 * markup differ from the server's. So the first render leads with Apple silicon, and the platform
 * is read in an effect. A Mac whose chip the platform string cannot reveal is refined once from
 * the chip signals (`downloadPlatform.ts` says why the platform string is not enough); until, and
 * unless, one answers, the guess stays marked uncertain.
 */
function useDownloadGuess(): DownloadGuess {
  const [guess, setGuess] = useState<DownloadGuess>({ id: 'mac-arm64', certain: true })
  useEffect(() => {
    const base = readPlatformSignals()
    const first = detectDownload(base)
    setGuess(first)
    if (first.certain) return
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

function DownloadAction({
  option,
  primary = false,
}: {
  option: DownloadOption
  primary?: boolean
}) {
  const Icon = option.icon
  const classes = cn(
    'flex w-full items-center gap-4 text-left transition-colors focus-ring',
    primary
      ? 'min-h-11 rounded-md bg-foreground px-3 py-2 text-background'
      : 'rounded-lg px-3 py-3 text-foreground hover:bg-surface-hover',
    !option.url && 'cursor-not-allowed opacity-55',
  )
  const content = (
    <>
      {primary ? <Download className="size-5 shrink-0" /> : <Icon className="size-5 shrink-0" />}
      <span
        className={cn(
          'min-w-0 flex-1',
          primary && 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5',
        )}
      >
        <span className={cn('block font-heading font-medium', primary ? 'text-sm' : 'text-base')}>
          {option.action}
        </span>
        <span
          className={cn(
            'block',
            primary ? 'text-xs text-background/60' : 'mt-0.5 text-sm text-text-faint',
          )}
        >
          {option.url ? option.artifact : `${option.artifact} · Coming soon`}
        </span>
      </span>
    </>
  )

  return option.url ? (
    <a className={classes} href={option.url}>
      {content}
    </a>
  ) : (
    <button className={classes} type="button" disabled>
      {content}
    </button>
  )
}

/**
 * The other platforms, on a layer of their own.
 *
 * This was a `<details>`, so opening it inserted a panel into the flow and
 * pushed the hero — and everything under it — down the page. The list is now
 * absolutely positioned against this row: the trigger keeps the exact box it
 * had when closed, which the static pre-render shell mirrors, and opening it
 * moves nothing.
 *
 * That trade buys the two behaviours a floating layer owes the reader, which
 * `<details>` never had: Escape closes it and hands focus back, and a click
 * anywhere else dismisses it.
 */
function AlternativeDownloads({ options }: { options: DownloadOption[] }) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div ref={rowRef} className="relative mt-1">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="download-alternatives"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 text-xs text-text-soft transition-colors hover:text-foreground"
      >
        <span>Also for {options.map(({ shortTitle }) => shortTitle).join(' · ')}</span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      <div
        id="download-alternatives"
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 mt-1 divide-y divide-border-subtle rounded-xl border border-border-subtle bg-card p-2 shadow-[var(--shadow-soft)]"
      >
        {options.map((option) => (
          <DownloadAction key={option.id} option={option} />
        ))}
      </div>
    </div>
  )
}

/**
 * Until a release exists there is no installer to offer, so the one honest primary action is to
 * build from source. A disabled "Download for Mac · Coming soon" button, which this used to show,
 * advertises a build that is not there.
 */
function SourceInstall({ className }: { className?: string }) {
  return (
    <div id="downloads" className={cn('w-full', className)}>
      <div className="flex flex-wrap gap-2">
        <ButtonLink to="/docs/getting-started--installation" size="md">
          <SquareTerminal className="size-4 shrink-0" />
          <span>Build from source</span>
        </ButtonLink>
        <ButtonLink to={githubUrl} external variant="outline" size="md">
          <GitHubMark className="size-4 shrink-0" />
          <span>View on GitHub</span>
        </ButtonLink>
        <ButtonLink to="/docs" variant="outline" size="md">
          <BookOpen className="size-4 shrink-0" />
          <span>Docs</span>
        </ButtonLink>
      </div>
    </div>
  )
}

export function DownloadChooser({
  className,
  downloads = DOWNLOADS,
}: {
  className?: string
  downloads?: DownloadOption[]
}) {
  if (!downloads.some(({ url }) => url)) return <SourceInstall className={className} />
  return <InstallerChooser className={className} downloads={downloads} />
}

function InstallerChooser({
  className,
  downloads,
}: {
  className?: string
  downloads: DownloadOption[]
}) {
  const guess = useDownloadGuess()
  const primary = downloads.find(({ id }) => id === guess.id) ?? downloads[0]
  const alternatives = downloads.filter(({ id }) => id !== primary.id)
  // An undecided chip must not leave the other Mac build one menu away from the person who
  // needs it: name it right under the button.
  const otherMac = guess.certain
    ? undefined
    : downloads.find(({ id }) => id === (primary.id === 'mac-arm64' ? 'mac-x64' : 'mac-arm64'))

  return (
    <div id="downloads" className={cn('w-full', className)}>
      <div className="inline-grid max-w-full grid-cols-[auto_auto] gap-2">
        <ButtonLink to={githubUrl} external variant="outline" size="sm">
          <GitHubMark className="size-4 shrink-0" />
          <span>View on GitHub</span>
        </ButtonLink>
        <ButtonLink to="/docs" variant="outline" size="sm">
          <BookOpen className="size-4 shrink-0" />
          <span>Docs</span>
        </ButtonLink>
        <div className="col-span-2 min-w-0">
          <DownloadAction option={primary} primary />
          {otherMac?.url && (
            <p className="mt-2 px-2 text-xs text-text-soft">
              Not sure which Mac you have? Apple menu → About This Mac names the chip.{' '}
              <a
                href={otherMac.url}
                className="rounded-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none hover:decoration-current focus-ring"
              >
                {otherMac.action}
              </a>
            </p>
          )}
          <AlternativeDownloads options={alternatives} />
          {!primary.url && (
            <p className="mt-2 px-2 text-xs text-text-soft">
              This platform's installer is not in the release yet.{' '}
              <Link
                to="/docs/getting-started--installation"
                className="rounded-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none hover:decoration-current focus-ring"
              >
                Build from source
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
