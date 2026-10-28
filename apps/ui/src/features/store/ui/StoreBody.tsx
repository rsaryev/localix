import {
  PACKAGE_KINDS,
  type BrowsableComponentKind,
  type Listing,
  type PackageKind,
} from '@localixai/store'
import { SectionHeading } from '@localixai/kit/section-heading'
import {
  COMPONENT_LABELS,
  KIND_LABELS,
  LIBRARY_LABELS,
  capabilityLabel,
  inSentence,
} from '../model/presentation'
import type { StoreSection, StoreView } from '../model/navigation'
import { useStoreScope } from '../model/storeContext'
import { useStoreRecommendations } from '@/shared/hooks/useStoreRecommendations'
import { useDiscover } from '../model/useStoreData'
import { RecommendedView } from './RecommendedView'
import { CreateBar } from './CreateDialog'
import { ShelfActionButtons } from './ShelfActions'
import { Discover, DiscoverSkeleton } from './Discover'
import { ListingsView } from './ListingsView'
import { PackageView } from './PackageView'
import { SearchResults } from './SearchResults'
import { StoreComponents } from './StoreComponents'
import { StoreLibrary } from './StoreLibrary'
import { StoreSources } from './StoreSources'
import { StoreBackButton } from './StoreBackButton'
import { StoreReadFailure } from './StoreReadFailure'

const KIND_NOTES: Partial<Record<PackageKind, string>> = {
  'mini-app': 'Screens and tools that work beside your chats. One you install appears in the rail.',
  plugin: 'Skills, agents, commands, hooks and servers for Claude Code and the agents here.',
}

const AUTHORED_NOTES = {
  yours:
    'What you wrote: skills, agents and servers in your own files, in every project. What you installed from a source is under Installed.',
  project: 'What this project keeps in its own folder, shared with whoever opens it.',
}

function DiscoverSection() {
  const store = useStoreScope()
  const discover = useDiscover(store.client, store.project?.id ?? null)
  const recommended = useStoreRecommendations(
    store.client,
    store.project?.id ?? null,
    store.sessionId,
  )
  if (!discover.data)
    return discover.error ? (
      <StoreReadFailure
        what="Discover"
        error={discover.error}
        onRetry={() => void discover.mutate()}
      />
    ) : (
      <DiscoverSkeleton />
    )
  return <Discover data={discover.data} recommended={recommended.data?.listings ?? []} />
}

/** What the Store shows for where it is: a search, a page over the section, or the section. */
export function StoreBody({
  section,
  query,
  view,
  backLabel,
  onBack,
  onAddSource,
}: {
  section: StoreSection
  query: string
  view: (StoreView & { listing?: Listing }) | undefined
  backLabel: string
  onBack: () => void
  onAddSource: () => void
}) {
  if (query) return <SearchResults query={query} />
  if (view?.type === 'listing')
    return (
      <PackageView
        reference={view.ref}
        listing={view.listing}
        focus={view.focus}
        tab={view.tab}
        backLabel={backLabel}
        onBack={onBack}
      />
    )
  if (view?.type === 'recommended')
    return (
      <div className="flex flex-col gap-3">
        <StoreBackButton label={backLabel} onBack={onBack} />
        <RecommendedView />
      </div>
    )
  if (view?.type === 'list')
    return (
      <div className="flex flex-col gap-3">
        <StoreBackButton label={backLabel} onBack={onBack} />
        <ListingsView
          title={view.title}
          subtitle={view.subtitle}
          query={view.query}
          refs={view.refs}
        />
      </div>
    )
  if (section === 'discover') return <DiscoverSection />
  if (section === 'sources') return <StoreSources onAdd={onAddSource} />
  if (section === 'installed' || section === 'updates')
    return (
      <div className="flex flex-col gap-6">
        <SectionHeading
          title={section === 'installed' ? 'Installed' : 'Updates'}
          description={
            section === 'installed'
              ? 'What you installed from a source, where and which version. What you wrote is under Yours.'
              : undefined
          }
        />
        <StoreLibrary updates={section === 'updates'} />
      </div>
    )
  if (section === 'yours' || section === 'project')
    return (
      <ListingsView
        title={LIBRARY_LABELS[section].label}
        subtitle={AUTHORED_NOTES[section]}
        query={{ shelf: section }}
        actions={
          <CreateBar
            kinds="all"
            initial={section === 'project' ? 'project' : 'user'}
            before={<ShelfActionButtons scope={section === 'project' ? 'project' : 'user'} />}
          />
        }
      />
    )
  if (section.startsWith('capability:')) {
    const kind = section.slice(11) as BrowsableComponentKind
    return (
      <div className="flex flex-col gap-6">
        <SectionHeading
          actions={<CreateBar kinds={[kind as PackageKind]} />}
          title={capabilityLabel(kind)}
          description={`${
            (PACKAGE_KINDS as readonly string[]).includes(kind) ? 'Yours, your project’s and ' : ''
          }every ${inSentence(COMPONENT_LABELS[kind].one)} a package adds. Getting one from a package gets the whole package.`}
        />
        <StoreComponents kind={kind} />
      </div>
    )
  }
  const kind = section.slice(8) as PackageKind
  return (
    <ListingsView
      title={KIND_LABELS[kind].many}
      subtitle={KIND_NOTES[kind]}
      query={{ shelf: section }}
      actions={<CreateBar kinds={[kind]} />}
    />
  )
}
