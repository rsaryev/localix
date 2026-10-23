import type { RailArea, RailItemDef } from './railLayout'
import type { RailAction, RailEntry, RailSection } from '../ui/shellTypes'
import { isRailTool } from './railToolGroups'

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
 * freshly enabled mini app panel) lands. Pure — no React/DOM — so the id/area/active
 * mapping can be unit-tested.
 *
 * Mini app views are pinned by default and grouped in the rail. Explicit unpins use overflow.
 */
export function buildRailEntries(input: BuildRailEntriesInput): BuiltRailEntries {
  const entryMap = new Map<string, RailEntry>()
  const defs: RailItemDef[] = []
  const addEntry = (entry: RailEntry, defaultArea: RailArea) => {
    entryMap.set(entry.id, entry)
    defs.push(
      isRailTool(entry)
        ? {
            id: entry.id,
            defaultArea: !entry.miniApp && defaultArea === 'status' ? 'status' : 'bar',
            miniApp: entry.miniApp,
            tool: true,
          }
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
        miniApp: s.miniApp,
        toolCategory: s.toolCategory,
        miniAppName: s.miniAppName,
        resourceUri: s.resourceUri,
      },
      s.defaultArea ?? 'bar',
    ),
  )
  input.customizableActions.forEach((a) =>
    addEntry(
      {
        id: a.id,
        statusLabel: a.statusLabel,
        icon: a.icon,
        label: a.label,
        active: !!a.active,
        onClick: a.onClick,
        chordId: a.chordId,
        miniApp: a.miniApp,
        toolCategory: a.toolCategory,
        miniAppName: a.miniAppName,
        resourceUri: a.resourceUri,
        extraMenu: a.extraMenu,
      },
      a.defaultArea ?? (a.overflowGroup ? 'overflow' : 'bar'),
    ),
  )

  return { entryMap, defs }
}
