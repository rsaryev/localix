import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import type { Listing, ListingRef, PackageKind, StoreComponent } from '@localixai/store'
import { SearchInput } from '@localixai/kit/search-input'
import { useElementWidth } from '@localixai/kit/lib'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import type { StoreClient } from '@/shared/api/store-client'
import type { StoreTarget } from '@/shared/lib/openStore'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { layoutFor, StoreFrameContext } from '../model/layout'
import {
  parseSection,
  sectionLabel,
  storeNav,
  type StoreSection,
  type StoreView as View,
} from '../model/navigation'
import { StoreMemoryContext } from '../model/storeMemory'
import { StoreScopeContext, type StoreProject, type StoreScope } from '../model/storeContext'
import { useStoreActions } from '../model/useStoreActions'
import { keyOf } from '../model/useExtrasAfterInstall'
import {
  prefetchDetail,
  useCreatable,
  useStoreFacets,
  useStoreSources,
} from '../model/useStoreData'
import { createReadAhead } from '../model/readAhead'
import { useDebounced } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { SEARCH_DEBOUNCE_MS } from '../model/searchDebounce'
import { AddSourceDialog } from './AddSourceDialog'
import { ConsentSheet } from './ConsentSheet'
import { StoreScrollContext } from './PagedList'
import { StoreBody } from './StoreBody'
import { StoreNav } from './StoreNav'

/** A view over the section, with the listing in hand when it was opened from a card. */
type Opened = View & { listing?: Listing }

/** How long the pointer rests on a card before its page is read ahead. */
const INTENT_MS = 120

/**
 * THE STORE (`docs/internals/store.md`, "Screens"): the bar on top (`StoreNav`: search and
 * library, the catalog's tabs under them), and below it Discover, a shelf, a package's page, the library or the
 * sources. It renders the contract and
 * names no provider; `target` is where the tab was opened.
 */
export function StoreView({
  client,
  target,
  extras,
  project = null,
  sessionId = null,
  onNavigate,
  searchDelay = SEARCH_DEBOUNCE_MS,
}: {
  client: StoreClient
  target?: StoreTarget
  /** What a listing can get beside a plain install, as other features offer it. */
  extras: readonly StoreInstallExtra[]
  /** The project open beside the Store. */
  project?: StoreProject | null
  /** The chat open beside the Store: what it works in is part of what suits it. */
  sessionId?: string | null
  /** Open a `localix://` address: an installed package, a provider's settings. */
  onNavigate: (uri: string) => void
  searchDelay?: number
}) {
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const width = useElementWidth(root)
  const layout = layoutFor(width)
  const [section, setSection] = useState<StoreSection>('discover')
  const [stack, setStack] = useState<Opened[]>([])
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<{ kind?: PackageKind; input: string } | null>(null)
  const scrolls = useRef<number[]>([])
  const [memory] = useState(() => new Map<string, unknown>())
  const [ahead] = useState(() =>
    createReadAhead<() => void>({ delayMs: INTENT_MS, read: (prefetch) => prefetch() }),
  )
  const q = useDebounced(query.trim(), searchDelay)
  const facets = useStoreFacets(client, project?.id ?? null)
  const sources = useStoreSources(client)
  const actions = useStoreActions({ client, project, navigate: onNavigate })

  // Each open of the tab is a new target: go where it says.
  const [arrived, setArrived] = useState<StoreTarget | undefined>(undefined)
  if (target && target !== arrived) {
    setArrived(target)
    // A plain open names no place: it lands on Discover, as the first one does.
    const plain = !target.shelf && !target.ref && !target.recommended && !target.addSource
    const next = plain ? 'discover' : parseSection(target.shelf)
    if (next) setSection(next)
    setStack(
      target.ref
        ? [{ type: 'listing', ref: target.ref as ListingRef }]
        : target.recommended
          ? [{ type: 'recommended' }]
          : [],
    )
    if (target.ref || target.recommended || next) setQuery('')
    if (target.addSource)
      setAdding({ kind: target.addSource.kind as PackageKind, input: target.addSource.input })
  }

  // Back from a page: where the list was scrolled to.
  const depth = stack.length
  useLayoutEffect(() => {
    const saved = scrolls.current[depth]
    if (scroller.current) scroller.current.scrollTop = saved ?? 0
  }, [depth, section])

  const push = useCallback(
    (view: Opened) => {
      scrolls.current[depth] = scroller.current?.scrollTop ?? 0
      setQuery('')
      setStack((current) => [...current, view])
    },
    [depth],
  )
  const scope: StoreScope = useMemo(
    () => ({
      client,
      project,
      sessionId,
      open: (item: Listing | ListingRef, focus?: Pick<StoreComponent, 'kind' | 'name'>) =>
        push(
          'ref' in item
            ? { type: 'listing', ref: item.ref, listing: item, focus }
            : { type: 'listing', ref: item, focus },
        ),
      configure: (item: Listing) =>
        push({ type: 'listing', ref: item.ref, listing: item, tab: 'settings' }),
      show: push,
      goTo: (next) => {
        setSection(next)
        setStack([])
        setQuery('')
      },
      prefetch: (ref) => ahead.intent(() => prefetchDetail(client, ref, project?.id ?? null)),
      get: actions.get,
      update: actions.update,
      remove: actions.remove,
      setEnabled: actions.setEnabled,
      updateAll: actions.updateAll,
      run: actions.run,
      navigate: onNavigate,
      extrasFor: (listing) => extras.filter((extra) => extra.available(listing)),
      makeExtra: (extra, listing) => actions.extras.make(extra, listing),
      removeExtra: (extra, listing) => actions.run(extra.remove(listing)),
      extraProblems: actions.extras.problems,
    }),
    [client, project, sessionId, actions, extras, onNavigate, push, ahead],
  )
  const frame = useMemo(() => ({ layout, width }), [layout, width])
  const creatable = useCreatable(client)
  const sections = storeNav(facets.data?.facets, creatable.data)
  const choose = (id: string) => scope.goTo(id as StoreSection)
  const search = (
    <SearchInput
      value={query}
      onValueChange={setQuery}
      placeholder="Search apps, plugins, skills…"
      aria-label="Search the Store"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && query) {
          event.preventDefault()
          setQuery('')
        }
      }}
      size="md"
      className="w-full"
    />
  )
  const top = stack.at(-1)
  const back = () => setStack((current) => current.slice(0, -1))
  const backLabel = stack.length > 1 ? 'Back' : sectionLabel(section)

  return (
    <StoreScopeContext.Provider value={scope}>
      <StoreMemoryContext.Provider value={memory}>
        <StoreFrameContext.Provider value={frame}>
          <div
            ref={root}
            data-layout={layout}
            className="flex h-full min-h-0 flex-col"
            onScrollCapture={ahead.scrolled}
            onWheelCapture={ahead.scrolled}
          >
            <StoreNav
              sections={sections}
              // While a search shows its results, no section is the one on screen.
              active={q ? '' : section}
              onChange={choose}
              search={search}
              layout={layout}
            />
            <div className="flex min-h-0 flex-1">
              <div
                ref={scroller}
                data-store-scroller
                className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pt-4 pb-6 @2xl:px-6"
              >
                {actions.problem && (
                  <WorkbenchNoticeBar
                    role="alert"
                    tone="error"
                    layout="stacked"
                    icon={<CircleAlert className="size-3.5" />}
                    title={actions.problem}
                    dismissLabel="Dismiss"
                    onDismiss={actions.dismissProblem}
                    className="mb-3 rounded-md border border-border-faint"
                  />
                )}
                <StoreScrollContext.Provider value={scroller}>
                  <StoreBody
                    key={
                      q
                        ? 'search'
                        : top
                          ? `${depth}:${top.type === 'listing' ? keyOf(top.ref) : top.type === 'list' ? top.title : top.type}`
                          : section
                    }
                    section={section}
                    query={q}
                    view={top}
                    backLabel={backLabel}
                    onBack={back}
                    onAddSource={() => setAdding({ input: '' })}
                  />
                </StoreScrollContext.Provider>
              </div>
            </div>
            {actions.asking && <ConsentSheet request={actions.asking} onAnswer={actions.answer} />}
            {adding && (
              <AddSourceDialog
                kinds={sources.data?.addable ?? []}
                initial={adding.input ? adding : undefined}
                preview={(kind, input) => client.previewSource(kind, input)}
                add={async (kind, input) => {
                  await client.addSource(kind, input)
                }}
                onClose={() => setAdding(null)}
              />
            )}
          </div>
        </StoreFrameContext.Provider>
      </StoreMemoryContext.Provider>
    </StoreScopeContext.Provider>
  )
}
