import {
  BROWSABLE_COMPONENT_KINDS,
  PACKAGE_SHELF_KINDS,
  capabilityShelf,
  packageShelf,
  parseShelf,
  type ListingRef,
  type PackageKind,
  type StoreComponent,
  type StoreFacets,
} from '@localixai/store'
import type { LucideIcon } from 'lucide-react'
import type { TabItem } from '@localixai/kit/tabs'
import type { StorePageQuery } from '@/shared/api/store-client'
import { capabilityLabel, COMPONENT_LABELS, KIND_LABELS, LIBRARY_LABELS } from './presentation'

/** Where the Store is: a shelf, or its Sources page. */
export type StoreSection = NonNullable<ReturnType<typeof parseShelf>> | 'sources'

/**
 * What the Store shows over its section: a package's page (opened for one of its components,
 * that one marked), or a full list — a row's "See all", a category, a collection, a source.
 */
export type StoreView =
  | {
      type: 'listing'
      ref: ListingRef
      focus?: Pick<StoreComponent, 'kind' | 'name'>
      /** The tab of the page to open on: `settings` for Configure. */
      tab?: string
    }
  | { type: 'list'; title: string; subtitle?: string; query?: StorePageQuery; refs?: ListingRef[] }
  /** Every recommendation for the work, ranked (`RecommendedView`). */
  | { type: 'recommended' }

/**
 * A section from a link or a restored tab. A skill, an agent or an MCP server no longer has a shelf
 * of packages; an old link to it lands on the one shelf that lists them.
 */
export function parseSection(raw: unknown): StoreSection | null {
  if (raw === 'sources') return 'sources'
  const shelf = parseShelf(raw)
  const kind = shelf?.startsWith('package:') ? shelf.slice(8) : ''
  return kind && !(PACKAGE_SHELF_KINDS as readonly string[]).includes(kind)
    ? (`capability:${kind}` as StoreSection)
    : shelf
}

/** The kinds of what packages give that are tabs of their own; the rest wait under More. */
const LEADING_KINDS: readonly string[] = ['skill', 'agent', 'mcp-server']

/** The Store's sections, as its bar draws them (`StoreNav`). */
export interface StoreNavSections {
  /** The catalog's tabs: Discover, the package kinds, skills, agents and MCP servers. */
  catalog: TabItem[]
  /** The other kinds packages give (commands, hooks, mods…), in a More menu. */
  more: TabItem[]
  /** The person's library beside the search: Installed, Updates, Yours, Project, Sources. */
  library: TabItem[]
}

/**
 * The Store's sections from the facets (`docs/internals/store.md`, "Hierarchy"): Discover, one
 * shelf for each package kind that is only a package (mini apps, plugins) and per component kind
 * some listing has, the library and Sources. A skill, an agent and an MCP server have ONE shelf,
 * under what packages give, listing the ones a person has and those inside plugins. A shelf no
 * listing is on is left out, unless its kind can make a new item: that shelf is where Add is.
 * Only Updates carries a count: it is the one that asks for something.
 */
export function storeNav(
  facets: StoreFacets | undefined,
  creatable: readonly PackageKind[] = [],
): StoreNavSections {
  const count = (id: string) => facets?.shelves[id]
  const shelf = (id: string, label: string, icon: LucideIcon, always = false): TabItem[] =>
    count(id) || always ? [{ id, label, icon }] : []
  const given = BROWSABLE_COMPONENT_KINDS.flatMap((kind) =>
    shelf(
      capabilityShelf(kind),
      capabilityLabel(kind),
      COMPONENT_LABELS[kind].icon,
      creatable.includes(kind as PackageKind),
    ),
  )
  const leads = (tab: TabItem) => LEADING_KINDS.includes(tab.id.slice('capability:'.length))
  const updates = count('updates')
  return {
    catalog: [
      { id: 'discover', label: LIBRARY_LABELS.discover.label, icon: LIBRARY_LABELS.discover.icon },
      ...PACKAGE_SHELF_KINDS.flatMap((kind) =>
        shelf(
          packageShelf(kind),
          KIND_LABELS[kind].many,
          KIND_LABELS[kind].icon,
          creatable.includes(kind),
        ),
      ),
      ...given.filter(leads),
    ],
    more: given.filter((tab) => !leads(tab)),
    library: [
      {
        id: 'installed',
        label: LIBRARY_LABELS.installed.label,
        icon: LIBRARY_LABELS.installed.icon,
      },
      ...(updates
        ? [
            {
              id: 'updates',
              label: LIBRARY_LABELS.updates.label,
              icon: LIBRARY_LABELS.updates.icon,
              badge: updates,
            },
          ]
        : []),
      ...shelf('yours', LIBRARY_LABELS.yours.label, LIBRARY_LABELS.yours.icon),
      ...shelf('project', LIBRARY_LABELS.project.label, LIBRARY_LABELS.project.icon),
      { id: 'sources', label: LIBRARY_LABELS.sources.label, icon: LIBRARY_LABELS.sources.icon },
    ],
  }
}

/** The label of a section, for its heading and the Back button. */
export function sectionLabel(section: StoreSection): string {
  if (section.startsWith('package:')) return KIND_LABELS[section.slice(8) as PackageKind].many
  if (section.startsWith('capability:'))
    return capabilityLabel(section.slice(11) as (typeof BROWSABLE_COMPONENT_KINDS)[number])
  return LIBRARY_LABELS[section as keyof typeof LIBRARY_LABELS].label
}
