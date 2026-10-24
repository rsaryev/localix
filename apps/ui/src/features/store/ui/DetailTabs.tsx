import { useEffect, useRef, useState } from 'react'
import type { Listing, ListingDetail, StoreComponent } from '@localixai/store'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { TabBar, TabPanel, useTabPanelIds } from '@localixai/kit/tabs'
import type { StoreClient } from '@/shared/api/store-client'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { COMPONENT_LABELS } from '../model/presentation'
import { useInstallPlan } from '../model/useStoreData'

type TabId = 'overview' | 'inside' | 'permissions' | 'versions'

const isLink = (value: string) => value.startsWith('https://')

function Facts({ facts }: { facts: ListingDetail['facts'] }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-xs">
      {facts.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-text-faint">{label}</dt>
          <dd className="min-w-0 truncate text-text-soft">
            {isLink(value) ? (
              <ExternalAnchor
                href={value}
                className="truncate text-foreground underline-offset-2 hover:underline"
              >
                {value.replace(/^https:\/\//, '')}
              </ExternalAnchor>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

type Part = { kind: keyof typeof COMPONENT_LABELS; name: string; description?: string }

/** A list of parts: each with its kind's glyph, its name and what it is; `marked` stands out. */
function Parts({ parts, marked }: { parts: Part[]; marked?: Pick<Part, 'kind' | 'name'> }) {
  const markedRow = useRef<HTMLLIElement>(null)
  useEffect(() => markedRow.current?.scrollIntoView?.({ block: 'nearest' }), [])
  return (
    <ul className="flex flex-col gap-1">
      {parts.map(({ kind, name, description }) => {
        const Icon = COMPONENT_LABELS[kind].icon
        const isMarked = marked?.kind === kind && marked.name === name
        return (
          <li
            key={`${kind}:${name}`}
            ref={isMarked ? markedRow : undefined}
            aria-current={isMarked ? 'true' : undefined}
            className={cn(
              'flex min-h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-sm',
              isMarked && 'bg-surface-active',
            )}
          >
            <Icon className="size-4 shrink-0 text-text-faint" aria-hidden />
            <span className="truncate text-foreground">{name}</span>
            <span className="truncate text-xs text-text-soft">
              {description ?? COMPONENT_LABELS[kind].one}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Permissions({ client, listing }: { client: StoreClient; listing: Listing }) {
  const { data: plan, error } = useInstallPlan(client, listing.ref, 'user', true)
  if (error) return <p className="text-xs text-status-warning">The plan could not be read.</p>
  if (!plan) return <LoadingHint>Reading what it would run…</LoadingHint>
  return (
    <div className="flex max-w-(--reading-measure) flex-col gap-4 text-sm">
      {plan.warnings.map((warning) => (
        <p key={warning} className="text-xs text-status-warning">
          {warning}
        </p>
      ))}
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-text-soft">Runs on this computer</h3>
        {plan.runs.length === 0 ? (
          <p className="text-xs text-text-soft">Nothing: it adds text and settings only.</p>
        ) : (
          <Parts
            parts={plan.runs.map((run) => ({
              kind: run.kind,
              name: run.name,
              description: run.command,
            }))}
          />
        )}
      </section>
      {plan.network.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-text-soft">Reaches</h3>
          <p className="text-xs text-text-soft">{plan.network.join(', ')}</p>
        </section>
      )}
    </div>
  )
}

/**
 * A listing page's tabs: Overview (README and facts), What's inside, Permissions (the plan) and
 * Versions. A tab with nothing to say is left out. Opened for one of its components, the page
 * starts on What's inside with that component marked.
 */
export function DetailTabs({
  client,
  listing,
  detail,
  focus,
}: {
  client: StoreClient
  listing: Listing
  detail: ListingDetail
  focus?: Pick<StoreComponent, 'kind' | 'name'>
}) {
  const [active, setActive] = useState<TabId>(
    focus && detail.components.length ? 'inside' : 'overview',
  )
  const ids = useTabPanelIds('store-detail')
  const installed = listing.installs[0]
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(detail.components.length ? [{ id: 'inside' as const, label: 'What’s inside' }] : []),
    { id: 'permissions', label: 'Permissions' },
    ...(listing.version || installed ? [{ id: 'versions' as const, label: 'Versions' }] : []),
  ]
  return (
    <div className="flex flex-col gap-4">
      <TabBar
        aria-label="About this package"
        items={tabs.map((tab) => ({ ...tab, ...ids.item(tab.id) }))}
        active={active}
        onChange={setActive}
      />
      <TabPanel id={ids.panelId(active)} aria-labelledby={ids.tabId(active)} active>
        {active === 'overview' && (
          <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="max-w-(--reading-measure) min-w-0 text-sm">
              {detail.readme ? (
                <MarkdownRenderer rawHtml={false}>{detail.readme}</MarkdownRenderer>
              ) : (
                <p className="text-text-soft">{listing.summary}</p>
              )}
            </div>
            {detail.facts.length > 0 && <Facts facts={detail.facts} />}
          </div>
        )}
        {active === 'inside' && <Parts parts={detail.components} marked={focus} />}
        {active === 'permissions' && <Permissions client={client} listing={listing} />}
        {active === 'versions' && (
          <Facts
            facts={[
              ...(listing.version ? [{ label: 'Offered', value: listing.version }] : []),
              ...(installed?.version ? [{ label: 'Installed', value: installed.version }] : []),
              { label: 'Source', value: listing.source.label },
            ]}
          />
        )}
      </TabPanel>
    </div>
  )
}
