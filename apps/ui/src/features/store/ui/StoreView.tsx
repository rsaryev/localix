import { useLayoutEffect, useRef, useState } from 'react'
import type { Listing, ListingRef, PackageKind, Scope, StoreComponent } from '@localixai/store'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { ShelfNav } from '@localixai/kit/shelf-nav'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { StoreClient } from '@/shared/api/store-client'
import type { StoreTarget } from '@/shared/lib/openStore'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { NO_FILTER, type ShelfFilter } from '../model/filters'
import { navGroups, parseSection, sectionLabel, type StoreSection } from '../model/navigation'
import { useExtrasAfterInstall } from '../model/useExtrasAfterInstall'
import { useStoreListings, useStoreSources } from '../model/useStoreData'
import { AddSourceDialog } from './AddSourceDialog'
import { SectionSelect } from './SectionSelect'
import { StoreContent } from './StoreContent'

const scopeOf = (listing: Listing): Scope => listing.installs[0]?.scope ?? 'user'
const sameRef = (a: ListingRef, b: ListingRef) => a.kind === b.kind && a.id === b.id

/**
 * THE STORE (`docs/internals/store.md`, "Screens"): a search across everything on top, the
 * shelves on the left — Discover, Packages, Capabilities, Library, Sources, each hidden while
 * empty — and the shelf, a listing's page, the library or the sources beside them. It renders the
 * contract and names no provider; `target` is where the tab was opened.
 */
export function StoreView({
  client,
  target,
  extras,
  onConfigure,
}: {
  client: StoreClient
  target?: StoreTarget
  /** What a listing can get beside a plain install, as other features offer it. */
  extras: readonly StoreInstallExtra[]
  /** Open a provider's own settings for an install (a `localix://` address). */
  onConfigure: (uri: string) => void
}) {
  const [chosen, setSection] = useState<StoreSection>('discover')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ListingRef | null>(null)
  const [focus, setFocus] = useState<Pick<StoreComponent, 'kind' | 'name'> | undefined>()
  const [filter, setFilter] = useState<ShelfFilter>(NO_FILTER)
  const [adding, setAdding] = useState<{ kind: PackageKind; input?: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  const returnTo = useRef<string | null>(null)

  // Each open of the tab is a new target: go where it says.
  const [arrived, setArrived] = useState<StoreTarget | undefined>(undefined)
  if (target && target !== arrived) {
    setArrived(target)
    const next = parseSection(target.shelf)
    if (next) setSection(next)
    if (next || target.ref) setFilter(NO_FILTER)
    setOpened(target.ref ? (target.ref as ListingRef) : null)
    setFocus(undefined)
    if (target.addSource)
      setAdding({ kind: target.addSource.kind as PackageKind, input: target.addSource.input })
  }

  const q = query.trim()
  const everything = useStoreListings(client, {})
  const facets = everything.data?.facets
  // Discover holds nothing yet: show the first shelf that has something.
  const firstShelf = Object.keys(facets?.shelves ?? {}).find((id) => id.startsWith('package:'))
  const section =
    chosen === 'discover' && facets && !facets.shelves.discover && firstShelf
      ? (firstShelf as StoreSection)
      : chosen
  const shelf = section === 'sources' ? undefined : section
  const page = useStoreListings(client, q ? { q } : { shelf })
  const sources = useStoreSources(client)
  const all = everything.data?.listings ?? []
  const after = useExtrasAfterInstall(all, extras)

  // Back on the shelf: where it was scrolled to, and focus on the card that was opened.
  useLayoutEffect(() => {
    if (opened || !returnTo.current) return
    if (scroller.current) scroller.current.scrollTop = listScroll.current
    scroller.current
      ?.querySelector<HTMLButtonElement>(
        `[data-listing="${CSS.escape(returnTo.current)}"] > button`,
      )
      ?.focus()
    returnTo.current = null
  }, [opened])

  const refresh = () => Promise.all([everything.mutate(), page.mutate(), sources.mutate()])
  const run = (write: Promise<unknown>) =>
    void write
      .then(() => setProblem(null))
      .catch((error: unknown) => setProblem(errorMessage(error, 'The Store could not do that')))
      .finally(() => void refresh())
  const actions = {
    onInstall: (listing: Listing, consent: boolean) =>
      run(client.install(listing.ref, 'user', { plan: consent })),
    onUpdate: (listing: Listing) => run(client.update(listing.ref, scopeOf(listing))),
    onRemove: (listing: Listing) => run(client.remove(listing.ref, scopeOf(listing))),
  }
  const offered = (listing: Listing) => extras.filter((extra) => extra.available(listing))
  const extrasFor = (listing: Listing) =>
    offered(listing).map((extra) => ({
      extra,
      choose: (consent: boolean) => {
        after.afterInstall(extra, listing)
        actions.onInstall(listing, consent)
      },
    }))
  const madeFor = (listing: Listing) =>
    offered(listing).map((extra) => ({
      extra,
      has: extra.has(listing),
      add: () => after.make(extra, listing),
      remove: () => void extra.remove(listing),
    }))
  const openListing = (listing: Listing, component?: StoreComponent) => {
    listScroll.current = scroller.current?.scrollTop ?? 0
    setOpened(listing.ref)
    setFocus(component ? { kind: component.kind, name: component.name } : undefined)
  }
  const back = () => {
    returnTo.current = opened?.id ?? null
    setOpened(null)
  }
  const choose = (id: string) => {
    setSection(id as StoreSection)
    setOpened(null)
    setQuery('')
    setFilter(NO_FILTER)
  }

  const groups = navGroups(facets)
  const openedListing = opened ? all.find((listing) => sameRef(listing.ref, opened)) : undefined
  const loading = !everything.data && !everything.error
  return (
    <div className="@container/store flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-3 @2xl/store:px-6">
        <h1 className="text-base font-semibold text-foreground">Store</h1>
        <SearchInput
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            setOpened(null)
          }}
          placeholder="Search everything"
          aria-label="Search the Store"
          size="md"
          className="w-72 max-w-full min-w-0 flex-1 @2xl/store:flex-none"
        />
        <SectionSelect
          groups={groups}
          active={q ? '' : section}
          onSelect={choose}
          className="@2xl/store:hidden"
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <ShelfNav
          label="Store sections"
          groups={groups}
          active={q ? '' : section}
          onSelect={choose}
          className="hidden w-48 shrink-0 overflow-y-auto px-3 pb-4 @2xl/store:flex"
        />
        <div
          ref={scroller}
          className="@container min-w-0 flex-1 overflow-y-auto px-4 pb-6 @2xl/store:px-6"
        >
          {problem && <p className="px-2 pb-2 text-xs text-status-error">{problem}</p>}
          {loading ? (
            <LoadingHint>Loading the Store…</LoadingHint>
          ) : (
            <StoreContent
              client={client}
              section={section}
              query={q}
              listings={page.data?.listings ?? []}
              problems={everything.data?.problems ?? []}
              sources={sources.data ?? []}
              everything={all}
              opened={openedListing}
              focus={focus}
              backLabel={q ? 'Results' : sectionLabel(section)}
              filter={filter}
              onFilter={(patch) => setFilter((current) => ({ ...current, ...patch }))}
              onBack={back}
              onOpen={openListing}
              onTag={(tag) => {
                setFilter((current) => ({ ...current, tag }))
                if (opened) back()
              }}
              extrasFor={extrasFor}
              madeFor={madeFor}
              extraProblems={after.problems}
              onRemoveSource={(source) => run(client.removeSource(source.kind, source.id))}
              onAddSource={(kind) => setAdding({ kind })}
              onUpdateAll={() => run(client.applyUpdates())}
              onEnable={(listing, install, enabled) =>
                run(client.setEnabled(listing.ref, install.scope, enabled))
              }
              onConfigure={onConfigure}
              {...actions}
            />
          )}
        </div>
      </div>
      {adding && (
        <AddSourceDialog
          kind={adding.kind}
          open
          initialInput={adding.input}
          preview={client.previewSource}
          add={async (kind, input) => {
            await client.addSource(kind, input)
            await refresh()
          }}
          onOpenChange={(open) => !open && setAdding(null)}
        />
      )}
    </div>
  )
}
