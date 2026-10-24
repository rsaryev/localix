import type { Listing, PackageKind, SourceView, StoreInstall } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import type { StoreAppExtra } from '@/shared/lib/storeAppExtra'
import { keyOf, type ShelfFilter } from '../model/filters'
import type { StoreSection } from '../model/navigation'
import { sectionLabel } from '../model/navigation'
import type { useAppAfterInstall } from '../model/useAppAfterInstall'
import type { ListingActions } from './InstallAction'
import { StoreDetail } from './StoreDetail'
import { StoreLibrary } from './StoreLibrary'
import { StoreShelf } from './StoreShelf'
import { StoreSources } from './StoreSources'

const SECTION_NOTES: Partial<Record<string, string>> = {
  'package:mini-app':
    'Screens and tools that work beside your chats. One you install appears in the rail.',
  discover: 'What Localix features and recommends, of every kind.',
}

/** What the Store shows beside its shelves: a listing's page, results, a shelf, the library or sources. */
export function StoreContent({
  client,
  section,
  query,
  listings,
  problems,
  sources,
  opened,
  backLabel,
  filter,
  onFilter,
  onBack,
  onOpen,
  onTag,
  withApp,
  app,
  extra,
  onRemoveSource,
  onAddSource,
  onUpdateAll,
  onEnable,
  onConfigure,
  ...actions
}: {
  client: StoreClient
  section: StoreSection
  query: string
  listings: Listing[]
  problems: string[]
  sources: SourceView[]
  opened: Listing | undefined
  backLabel: string
  filter: ShelfFilter
  onFilter: (patch: Partial<ShelfFilter>) => void
  onBack: () => void
  onOpen: (listing: Listing) => void
  onTag: (tag: string) => void
  withApp: (listing: Listing) => ((consent: boolean) => void) | undefined
  app: ReturnType<typeof useAppAfterInstall>
  extra: StoreAppExtra | undefined
  onRemoveSource: (source: SourceView) => void
  onAddSource: (kind: PackageKind) => void
  onUpdateAll: () => void
  onEnable: (listing: Listing, install: StoreInstall, enabled: boolean) => void
  onConfigure: (uri: string) => void
} & ListingActions) {
  if (opened)
    return (
      <StoreDetail
        client={client}
        listing={opened}
        backLabel={backLabel}
        onBack={onBack}
        onTag={onTag}
        onInstallAsApp={withApp(opened)}
        app={
          extra?.available(opened)
            ? {
                has: extra.has(opened),
                add: () => app.make(opened),
                remove: () => void extra.remove(opened),
              }
            : undefined
        }
        appProblem={app.problems[keyOf(opened)]}
        {...actions}
      />
    )
  const title = query ? `Results for “${query}”` : sectionLabel(section)
  const note = query ? undefined : SECTION_NOTES[section]
  const kindOf = (section.startsWith('package:') ? section.slice(8) : undefined) as
    | PackageKind
    | undefined
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="px-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {note && <p className="text-xs text-text-soft">{note}</p>}
      </header>
      {problems.map((problem) => (
        <p key={problem} className="px-2 text-xs text-status-warning">
          {problem}
        </p>
      ))}
      {section === 'sources' && !query ? (
        <StoreSources sources={sources} onRemove={onRemoveSource} onAdd={onAddSource} />
      ) : (section === 'installed' || section === 'updates') && !query ? (
        <StoreLibrary
          listings={listings}
          updates={section === 'updates'}
          onUpdateAll={onUpdateAll}
          onOpen={onOpen}
          onUpdate={(listing) => actions.onUpdate(listing)}
          onRemove={(listing) => actions.onRemove(listing)}
          onEnable={onEnable}
          onConfigure={onConfigure}
        />
      ) : (
        <StoreShelf
          listings={listings}
          discover={section === 'discover' && !query}
          sources={sources}
          filter={filter}
          onFilter={onFilter}
          onRemoveSource={onRemoveSource}
          onAddSource={kindOf ? () => onAddSource(kindOf) : undefined}
          onOpen={onOpen}
          onTag={onTag}
          withApp={withApp}
          appProblems={app.problems}
          showKind={!kindOf || Boolean(query)}
          {...actions}
        />
      )}
    </div>
  )
}
