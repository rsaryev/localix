import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { ArrowLeft, MonitorUp, MonitorX } from 'lucide-react'
import type { MiniAppStoreEntryRecord, MiniAppStorePageRecord } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { CATEGORY_LABELS } from '../model/categories'
import type { LoadStorePage, StoreActions } from '../model/storeActions'
import { InstallAction } from './InstallAction'
import { MiniAppIcon } from '@/shared/ui/MiniAppIcon'
import { PublisherMark } from './MiniAppStoreRow'
import { ScreenshotCarousel } from './ScreenshotCarousel'
import { TagButton } from './TagButton'

const SURFACE_LABELS: Record<string, string> = {
  agent: 'Tools for the agent',
  workbench: 'A screen of its own',
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Details: version, size, license, author, homepage, API and what it adds. */
function Details({ details }: { details: MiniAppStorePageRecord['details'] }) {
  const adds = [
    ...(details.surfaces ?? []).map((surface) => SURFACE_LABELS[surface] ?? surface),
    ...(details.commands
      ? [`${details.commands} command${details.commands === 1 ? '' : 's'}`]
      : []),
  ]
  const rows: [string, React.ReactNode][] = [
    ['Version', details.version],
    ['Size', details.size ? size(details.size) : undefined],
    ['License', details.license],
    ['Author', details.author],
    [
      'Homepage',
      details.homepage ? (
        <ExternalAnchor
          key="homepage"
          href={details.homepage}
          className="truncate text-foreground underline-offset-2 hover:underline"
        >
          {details.homepage.replace(/^https:\/\//, '')}
        </ExternalAnchor>
      ) : undefined,
    ],
    ['Built for', details.apiVersion ? `Mini app API ${details.apiVersion}` : undefined],
    ['Adds', adds.length ? adds.join(' · ') : undefined],
  ]
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-xs">
      {rows
        .filter(([, value]) => value !== undefined)
        .map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-text-faint">{term}</dt>
            <dd className="min-w-0 truncate text-text-soft">{value}</dd>
          </div>
        ))}
    </dl>
  )
}

/**
 * One app's page in the store: a header with its large icon, who publishes it and the action,
 * its screenshots, its README as About, and Details. Its row's live entry drives the action, so
 * an install's progress shows here as it does in the list.
 */
export function MiniAppStoreDetail({
  entry,
  loadPage,
  onBack,
  onTag,
  onInstallWithDesktop,
  desktopApp,
  desktopProblem,
  ...actions
}: {
  entry: MiniAppStoreEntryRecord
  loadPage: LoadStorePage
  onBack: () => void
  onTag: (tag: string) => void
  onInstallWithDesktop?: (opts: { acceptUnverified?: boolean }) => void
  /** For an installed app that can have one: whether it has it, and how to add or remove it. */
  desktopApp?: { has: boolean; add: () => void; remove: () => void }
  desktopProblem?: string
} & StoreActions) {
  const label = entry.displayName ?? entry.name
  const heading = useRef<HTMLHeadingElement>(null)
  const { data: page, error } = useSWR(['mini-app-store-page', entry.name], () =>
    loadPage(entry.name),
  )
  // The page replaces the list: take focus to its heading so a screen reader starts here.
  useEffect(() => heading.current?.focus(), [])
  return (
    <article data-store-page={entry.name} className="flex min-w-0 flex-col gap-6 px-2">
      <div>
        <Button size="sm" variant="ghost" aria-label="Back to the store" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          Mini apps
        </Button>
      </div>
      <header className="flex flex-wrap items-start gap-5">
        <MiniAppIcon name={entry.name} label={label} icon={entry.icon} size={96} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold text-foreground outline-none"
          >
            {label}
          </h1>
          <p className="flex items-center gap-1.5 text-xs text-text-soft">
            {entry.publisher.verified && <span>{entry.publisher.name}</span>}
            <PublisherMark entry={entry} />
            {entry.category && <span aria-hidden>·</span>}
            {entry.category && <span>{CATEGORY_LABELS[entry.category] ?? entry.category}</span>}
            {entry.version && <span aria-hidden>·</span>}
            {entry.version && <span className="tabular-nums">{entry.version}</span>}
          </p>
          <p className="text-sm text-text-soft">{entry.description}</p>
          {(entry.tags?.length ?? 0) > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {entry.tags!.map((tag) => (
                <TagButton key={tag} tag={tag} onTag={onTag} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <InstallAction
            entry={entry}
            size="default"
            removeAs="button"
            onInstallWithDesktop={onInstallWithDesktop}
            {...actions}
          />
          {desktopApp && entry.installed && (
            <Button
              size="default"
              variant="ghost"
              onClick={desktopApp.has ? desktopApp.remove : desktopApp.add}
            >
              {desktopApp.has ? (
                <MonitorX data-icon="inline-start" aria-hidden />
              ) : (
                <MonitorUp data-icon="inline-start" aria-hidden />
              )}
              {desktopApp.has ? 'Remove desktop app' : 'Add desktop app'}
            </Button>
          )}
          {desktopProblem && (
            <p role="alert" className="max-w-64 text-right text-xs text-status-error">
              The desktop app was not made: {desktopProblem}
            </p>
          )}
        </div>
      </header>
      {!page && !error && <LoadingHint>Loading {label}…</LoadingHint>}
      {error && <p className="text-xs text-status-warning">This app’s page could not be read.</p>}
      {page && page.screenshots.length > 0 && (
        <ScreenshotCarousel shots={page.screenshots} title={label} />
      )}
      {page && (
        <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-labelledby="store-page-about" className="min-w-0">
            <h2 id="store-page-about" className="mb-2 text-sm font-semibold text-foreground">
              About
            </h2>
            {page.readme ? (
              <div className="max-w-(--reading-measure) text-sm">
                <MarkdownRenderer rawHtml={false}>{page.readme}</MarkdownRenderer>
              </div>
            ) : (
              <p className="text-sm text-text-soft">{entry.description}</p>
            )}
          </section>
          <section aria-labelledby="store-page-details">
            <h2 id="store-page-details" className="mb-2 text-sm font-semibold text-foreground">
              Details
            </h2>
            <Details details={page.details} />
          </section>
        </div>
      )}
    </article>
  )
}
