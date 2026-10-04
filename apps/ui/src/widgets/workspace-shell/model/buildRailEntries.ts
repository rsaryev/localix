import type { RailArea, RailItemDef } from './railLayout'
import type { RailAction, RailEntry, RailSection } from '../ui/shellTypes'

export interface BuildRailEntriesInput {
  /** Sidebar sections (Files, Database, …). */
  railSections: RailSection[]
  /** The CUSTOMIZABLE rail actions (workspace views); FIXED utilities are excluded upstream. */
  customizableActions: RailAction[]
  sidebarOpen: boolean
  activeSection: string | null
  onSectionClick: (id: string) => void
}

export interface BuiltRailEntries {
  /** Every resolved entry keyed by its stable, namespaced id. */
  entryMap: Map<string, RailEntry>
  /** Def order seeds the default arrangement + where a brand-new entry lands. */
  defs: RailItemDef[]
}

/**
 * Unify sidebar SECTIONS + workspace VIEWS into one customizable entry set with
 * stable, namespaced ids (`section:*`, action ids). Def
 * ORDER seeds the default arrangement and decides where a brand-new entry (e.g. a
 * freshly enabled plugin panel) lands. Pure — no React/DOM — so the id/area/active
 * mapping can be unit-tested.
 *
 * A PLUGIN-owned entry has no rail placement at all: it is marked NOT placeable, so
 * it resolves to `overflow` whatever its own `defaultArea` claims (Reader asks for
 * `'bar'`) and whatever an older saved layout put it in.
 * Plugin views reach the rail only through its recent slots, which the shell fills
 * from actual usage. Core/system entries are unaffected — their own `defaultArea`
 * still governs where they land and the user can still arrange them.
 */
export function buildRailEntries(input: BuildRailEntriesInput): BuiltRailEntries {
  const entryMap = new Map<string, RailEntry>()
  const defs: RailItemDef[] = []
  const addEntry = (entry: RailEntry, defaultArea: RailArea) => {
    entryMap.set(entry.id, entry)
    defs.push(
      entry.plugin
        ? { id: entry.id, defaultArea: 'overflow', placeable: false }
        : { id: entry.id, defaultArea },
    )
  }

  input.railSections.forEach((s) =>
    addEntry(
      {
        id: `section:${s.id}`,
        icon: s.icon,
        label: s.label,
        active: input.sidebarOpen && input.activeSection === s.id,
        onClick: () => input.onSectionClick(s.id),
        plugin: s.plugin,
        pluginName: s.pluginName,
        resourceUri: s.resourceUri,
      },
      s.defaultArea ?? 'bar',
    ),
  )
  input.customizableActions.forEach((a) =>
    addEntry(
      {
        id: a.id,
        icon: a.icon,
        label: a.label,
        active: !!a.active,
        onClick: a.onClick,
        chordId: a.chordId,
        plugin: a.plugin,
        pluginName: a.pluginName,
        resourceUri: a.resourceUri,
      },
      a.defaultArea ?? (a.overflowGroup ? 'overflow' : 'bar'),
    ),
  )

  return { entryMap, defs }
}
