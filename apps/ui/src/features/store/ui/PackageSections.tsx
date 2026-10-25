import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Listing, ListingDetail, StoreComponent } from '@localixai/store'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Skeleton } from '@localixai/kit/skeleton'
import { TabBar, TabPanel, useTabPanelIds } from '@localixai/kit/tabs'
import { COMPONENT_LABELS } from '../model/presentation'
import { PackageSettings } from './PackageSettings'
import { PlanSummary } from './PlanSummary'

type Part = Pick<StoreComponent, 'kind' | 'name' | 'description'>

/** A list of parts: each with its kind's glyph, its name and what it does; `marked` stands out. */
export function Parts({
  parts,
  marked,
}: {
  parts: readonly Part[]
  marked?: Pick<Part, 'kind' | 'name'>
}) {
  const markedRow = useRef<HTMLLIElement>(null)
  useEffect(() => markedRow.current?.scrollIntoView?.({ block: 'nearest' }), [])
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 @3xl:grid-cols-2">
      {parts.map(({ kind, name, description }) => {
        const Icon = COMPONENT_LABELS[kind].icon
        const isMarked = marked?.kind === kind && marked.name === name
        return (
          <li
            key={`${kind}:${name}`}
            ref={isMarked ? markedRow : undefined}
            aria-current={isMarked ? 'true' : undefined}
            className={cn(
              'flex min-h-10 min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5',
              isMarked && 'bg-surface-active',
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{name}</span>
              <span className="line-clamp-2 text-xs text-text-soft">
                {description ?? COMPONENT_LABELS[kind].one}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** While a package is read for the first time: rows the shape of its parts, and why. */
function Reading({ what }: { what: string }) {
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="text-xs text-text-soft">{what}</p>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden className="flex items-center gap-2.5 px-2 py-1.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

/**
 * One section of a package page under its tabs. The page draws the ones whose `available` says
 * so, in this order, so a new one — a provider's Settings, say — is one entry here and appears
 * only where it has something to show.
 */
export interface PackageTab {
  id: string
  label: string
  available: (page: PackageSectionsProps) => boolean
  render: (page: PackageSectionsProps) => ReactNode
}

export interface PackageSectionsProps {
  listing: Listing
  detail: ListingDetail | undefined
  focus?: Pick<StoreComponent, 'kind' | 'name'>
  /** The tab to open on, when the page was opened for one (Configure opens Settings). */
  tab?: string
}

/** Its components are still being read: a remote package is fetched the first time it is opened. */
const stillReading = ({ listing, detail }: PackageSectionsProps) =>
  !detail || (listing.contents === 'unknown' && detail.components.length === 0)

export const PACKAGE_TABS: readonly PackageTab[] = [
  {
    id: 'inside',
    label: 'What’s inside',
    available: (page) => stillReading(page) || page.detail!.components.length > 0,
    render: (page) =>
      stillReading(page) ? (
        <Reading what="Reading what it contains…" />
      ) : (
        <Parts parts={page.detail!.components} marked={page.focus} />
      ),
  },
  {
    id: 'permissions',
    label: 'Permissions',
    available: () => true,
    render: ({ listing }) => <PlanSummary listing={listing} />,
  },
  {
    id: 'versions',
    label: 'Versions',
    available: ({ listing }) => Boolean(listing.version || listing.installs.length),
    render: ({ listing }) => (
      <dl className="grid max-w-md grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {listing.version && (
          <>
            <dt className="text-text-faint">Offered</dt>
            <dd className="text-foreground tabular-nums">{listing.version}</dd>
          </>
        )}
        {listing.installs.map((install) => (
          <div key={install.scope} className="contents">
            <dt className="text-text-faint">
              {install.scope === 'user' ? 'Installed for you' : 'Installed in this project'}
            </dt>
            <dd className="text-foreground tabular-nums">
              {install.version ?? '—'}
              {install.updateTo && ` → ${install.updateTo}`}
            </dd>
          </div>
        ))}
        {listing.updatedAt && (
          <>
            <dt className="text-text-faint">Published</dt>
            <dd className="text-foreground">{new Date(listing.updatedAt).toLocaleDateString()}</dd>
          </>
        )}
      </dl>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    // Only an installed package that has something to set; Configure in the library opens it.
    available: ({ listing }) => Boolean(listing.configurable && listing.installs.length > 0),
    render: ({ listing }) => <PackageSettings listing={listing} />,
  },
]

/** The page's tabs, drawn from {@link PACKAGE_TABS}; opened for a component, What's inside. */
export function PackageSections(page: PackageSectionsProps) {
  const tabs = PACKAGE_TABS.filter((tab) => tab.available(page))
  const [chosen, setChosen] = useState(page.tab ?? (page.focus ? 'inside' : tabs[0]?.id))
  // Configure on a page that is already open asks for its Settings tab.
  const [asked, setAsked] = useState(page.tab)
  if (page.tab !== asked) {
    setAsked(page.tab)
    if (page.tab) setChosen(page.tab)
  }
  const ids = useTabPanelIds('store-package')
  const active = tabs.find((tab) => tab.id === chosen) ?? tabs[0]
  if (!active) return null
  return (
    <div className="flex flex-col gap-4">
      <TabBar
        aria-label="About this package"
        items={tabs.map((tab) => ({ id: tab.id, label: tab.label, ...ids.item(tab.id) }))}
        active={active.id}
        onChange={setChosen}
      />
      <TabPanel id={ids.panelId(active.id)} aria-labelledby={ids.tabId(active.id)} active>
        {active.render(page)}
      </TabPanel>
    </div>
  )
}
