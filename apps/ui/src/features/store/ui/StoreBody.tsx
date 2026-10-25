import { ArrowLeft } from 'lucide-react'
import {
  PACKAGE_KINDS,
  type BrowsableComponentKind,
  type Listing,
  type PackageKind,
} from '@localixai/store'
import { Button } from '@localixai/kit/button'
import {
  COMPONENT_LABELS,
  KIND_LABELS,
  LIBRARY_LABELS,
  capabilityLabel,
  inSentence,
} from '../model/presentation'
import type { StoreSection, StoreView } from '../model/navigation'
import { useStoreScope } from '../model/storeContext'
import { useDiscover } from '../model/useStoreData'
import { CreateBar } from './CreateDialog'
import { Discover, DiscoverSkeleton } from './Discover'
import { ListingsView } from './ListingsView'
import { PackageView } from './PackageView'
import { SearchResults } from './SearchResults'
import { StoreComponents } from './StoreComponents'
import { StoreLibrary } from './StoreLibrary'
import { StoreSources } from './StoreSources'

const KIND_NOTES: Partial<Record<PackageKind, string>> = {
  'mini-app': 'Screens and tools that work beside your chats. One you install appears in the rail.',
  plugin: 'Skills, agents, commands, hooks and servers for Claude Code and the agents here.',
}

const AUTHORED_NOTES = {
  yours:
    'What you wrote: skills, agents and servers in your own files, in every project. What you installed from a source is under Installed.',
  project: 'What this project keeps in its own folder, shared with whoever opens it.',
}

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <header className="mb-4">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {note && <p className="text-sm text-text-soft">{note}</p>}
    </header>
  )
}

function DiscoverSection() {
  const store = useStoreScope()
  const discover = useDiscover(store.client, store.project?.id ?? null)
  if (!discover.data) return <DiscoverSkeleton />
  return <Discover data={discover.data} />
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
  if (view?.type === 'list')
    return (
      <div className="flex flex-col gap-3">
        <div>
          <Button size="sm" variant="ghost" aria-label="Back" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            {backLabel}
          </Button>
        </div>
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
      <>
        <Heading
          title={section === 'installed' ? 'Installed' : 'Updates'}
          note={
            section === 'installed'
              ? 'What you installed from a source, where and which version. What you wrote is under Yours.'
              : undefined
          }
        />
        <StoreLibrary updates={section === 'updates'} />
      </>
    )
  if (section === 'yours' || section === 'project')
    return (
      <>
        <CreateBar kinds="all" initial={section === 'project' ? 'project' : 'user'} />
        <ListingsView
          title={LIBRARY_LABELS[section].label}
          subtitle={AUTHORED_NOTES[section]}
          query={{ shelf: section }}
        />
      </>
    )
  if (section.startsWith('capability:')) {
    const kind = section.slice(11) as BrowsableComponentKind
    return (
      <>
        <CreateBar kinds={[kind as PackageKind]} />
        <Heading
          title={capabilityLabel(kind)}
          note={`${
            (PACKAGE_KINDS as readonly string[]).includes(kind) ? 'Yours, your project’s and ' : ''
          }every ${inSentence(COMPONENT_LABELS[kind].one)} a package adds. Getting one from a package gets the whole package.`}
        />
        <StoreComponents kind={kind} />
      </>
    )
  }
  const kind = section.slice(8) as PackageKind
  return (
    <>
      <CreateBar kinds={[kind]} />
      <ListingsView
        title={KIND_LABELS[kind].many}
        subtitle={KIND_NOTES[kind]}
        query={{ shelf: section }}
      />
    </>
  )
}
