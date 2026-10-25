import {
  BROWSABLE_COMPONENT_KINDS,
  PACKAGE_KINDS,
  capabilityShelf,
  packageShelf,
  parseShelf,
  type ListingRef,
  type StoreComponent,
  type StoreFacets,
} from '@localixai/store'
import type { SidebarNavGroup } from '@localixai/kit/sidebar-nav'
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

export function parseSection(raw: unknown): StoreSection | null {
  return raw === 'sources' ? 'sources' : parseShelf(raw)
}

/**
 * The Store's sections from the facets (`docs/internals/store.md`, "Hierarchy"): Discover, one
 * shelf per package kind and per component kind some listing has, the library and Sources. A
 * capability's count is how many components it lists. A shelf no listing is on is left out.
 */
export function navGroups(facets: StoreFacets | undefined): SidebarNavGroup[] {
  const count = (id: string) => facets?.shelves[id]
  const shelf = (id: string, label: string, icon: SidebarNavGroup['items'][number]['icon']) =>
    count(id) ? [{ id, label, icon, count: count(id) }] : []
  return [
    {
      id: 'discover',
      items: [
        {
          id: 'discover',
          label: LIBRARY_LABELS.discover.label,
          icon: LIBRARY_LABELS.discover.icon,
        },
      ],
    },
    {
      id: 'packages',
      label: 'Packages',
      items: PACKAGE_KINDS.flatMap((kind) =>
        shelf(packageShelf(kind), KIND_LABELS[kind].many, KIND_LABELS[kind].icon),
      ),
    },
    {
      id: 'capabilities',
      label: 'Capabilities',
      items: BROWSABLE_COMPONENT_KINDS.flatMap((kind) =>
        shelf(capabilityShelf(kind), capabilityLabel(kind), COMPONENT_LABELS[kind].icon),
      ),
    },
    {
      id: 'library',
      label: 'Library',
      items: [
        {
          id: 'installed',
          label: LIBRARY_LABELS.installed.label,
          icon: LIBRARY_LABELS.installed.icon,
          count: facets?.installed ?? 0,
        },
        ...shelf('updates', LIBRARY_LABELS.updates.label, LIBRARY_LABELS.updates.icon),
        { id: 'sources', label: LIBRARY_LABELS.sources.label, icon: LIBRARY_LABELS.sources.icon },
      ],
    },
  ]
}

/** The label of a section, for its heading and the Back button. */
export function sectionLabel(section: StoreSection): string {
  if (section.startsWith('package:'))
    return KIND_LABELS[section.slice(8) as keyof typeof KIND_LABELS].many
  if (section.startsWith('capability:'))
    return capabilityLabel(section.slice(11) as (typeof BROWSABLE_COMPONENT_KINDS)[number])
  return LIBRARY_LABELS[section as keyof typeof LIBRARY_LABELS].label
}
