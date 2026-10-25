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

/**
 * The Store's sections from the facets (`docs/internals/store.md`, "Hierarchy"): Discover, one
 * shelf for each package kind that is only a package (mini apps, plugins) and per component kind
 * some listing has, the library and Sources. A skill, an agent and an MCP server have ONE shelf,
 * under what packages give, listing the ones a person has and those inside plugins; its count is
 * how many it lists. A shelf no listing is on is left out, unless its kind can make a new item:
 * that shelf is where Add is.
 */
export function navGroups(
  facets: StoreFacets | undefined,
  creatable: readonly PackageKind[] = [],
): SidebarNavGroup[] {
  const count = (id: string) => facets?.shelves[id]
  const shelf = (
    id: string,
    label: string,
    icon: SidebarNavGroup['items'][number]['icon'],
    always = false,
  ) => (count(id) || always ? [{ id, label, icon, count: count(id) ?? 0 }] : [])
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
      items: PACKAGE_SHELF_KINDS.flatMap((kind) =>
        shelf(
          packageShelf(kind),
          KIND_LABELS[kind].many,
          KIND_LABELS[kind].icon,
          creatable.includes(kind),
        ),
      ),
    },
    {
      id: 'gives',
      label: 'What packages give',
      items: BROWSABLE_COMPONENT_KINDS.flatMap((kind) =>
        shelf(
          capabilityShelf(kind),
          capabilityLabel(kind),
          COMPONENT_LABELS[kind].icon,
          creatable.includes(kind as PackageKind),
        ),
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
        ...shelf('yours', LIBRARY_LABELS.yours.label, LIBRARY_LABELS.yours.icon),
        ...shelf('project', LIBRARY_LABELS.project.label, LIBRARY_LABELS.project.icon),
        { id: 'sources', label: LIBRARY_LABELS.sources.label, icon: LIBRARY_LABELS.sources.icon },
      ],
    },
  ]
}

/** The label of a section, for its heading and the Back button. */
export function sectionLabel(section: StoreSection): string {
  if (section.startsWith('package:')) return KIND_LABELS[section.slice(8) as PackageKind].many
  if (section.startsWith('capability:'))
    return capabilityLabel(section.slice(11) as (typeof BROWSABLE_COMPONENT_KINDS)[number])
  return LIBRARY_LABELS[section as keyof typeof LIBRARY_LABELS].label
}
