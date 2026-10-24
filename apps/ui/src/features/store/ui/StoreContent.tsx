import type {
  BrowsableComponentKind,
  Listing,
  PackageKind,
  SourceView,
  StoreComponent,
  StoreInstall,
} from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import { keyOf, type ShelfFilter } from '../model/filters'
import type { StoreSection } from '../model/navigation'
import { sectionLabel } from '../model/navigation'
import { COMPONENT_LABELS } from '../model/presentation'
import type { ExtraChoice, ListingActions } from './InstallAction'
import { StoreComponents } from './StoreComponents'
import { StoreDetail, type ExtraMade } from './StoreDetail'
import { StoreLibrary } from './StoreLibrary'
import { StoreShelf } from './StoreShelf'
import { StoreSources } from './StoreSources'

const SECTION_NOTES: Partial<Record<string, string>> = {
  'package:mini-app':
    'Screens and tools that work beside your chats. One you install appears in the rail.',
  discover: 'What Localix features and recommends, of every kind.',
}

const capabilityNote = (kind: BrowsableComponentKind) =>
  `Every ${COMPONENT_LABELS[kind].one.toLowerCase()} a package adds. Installing one installs the package it comes in.`

/** What the Store shows beside its shelves: a listing's page, results, a shelf, the library or sources. */
export function StoreContent({
  client,
  section,
  query,
  listings,
  problems,
  sources,
  everything,
  opened,
  focus,
  backLabel,
  filter,
  onFilter,
  onBack,
  onOpen,
  onTag,
  extrasFor,
  madeFor,
  extraProblems,
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
  /** Every listing, whatever the shelf: what a card says is weighed against them. */
  everything: readonly Listing[]
  opened: Listing | undefined
  focus?: Pick<StoreComponent, 'kind' | 'name'>
  backLabel: string
  filter: ShelfFilter
  onFilter: (patch: Partial<ShelfFilter>) => void
  onBack: () => void
  onOpen: (listing: Listing, component?: StoreComponent) => void
  onTag: (tag: string) => void
  extrasFor: (listing: Listing) => ExtraChoice[]
  madeFor: (listing: Listing) => ExtraMade[]
  extraProblems: Record<string, string>
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
        extras={extrasFor(opened)}
        made={madeFor(opened)}
        extraProblem={extraProblems[keyOf(opened)]}
        focus={focus}
        {...actions}
      />
    )
  const title = query ? `Results for “${query}”` : sectionLabel(section)
  const capability = (
    section.startsWith('capability:') && !query ? section.slice(11) : undefined
  ) as BrowsableComponentKind | undefined
  const note = query ? undefined : capability ? capabilityNote(capability) : SECTION_NOTES[section]
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
      {capability ? (
        <StoreComponents kind={capability} listings={listings} onOpen={onOpen} {...actions} />
      ) : section === 'sources' && !query ? (
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
          peers={everything}
          extrasFor={extrasFor}
          extraProblems={extraProblems}
          showKind={!kindOf || Boolean(query)}
          {...actions}
        />
      )}
    </div>
  )
}
