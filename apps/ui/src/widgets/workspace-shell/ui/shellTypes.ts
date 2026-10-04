import type { ReactNode } from 'react'
import type { RailArea } from '../model/railLayout'

/** A section that slides open in the sidebar panel (history, files, etc.) */
export interface RailSection {
  id: string
  icon: ReactNode
  label: string
  content: ReactNode
  /** False for a core destination that must remain visible in the middle rail group. */
  customizable?: boolean
  /** Where this section defaults in the CUSTOMIZABLE rail before the user moves
   *  it — 'bar' (always visible) or 'overflow' (in the "…" menu). Default 'bar'. */
  defaultArea?: RailArea
  /** Contributed by a PLUGIN (not a built-in) — grouped under "Capabilities" in the
   *  overflow menu, apart from the built-in Views. */
  plugin?: boolean
  /** The plugin's package name, set alongside `plugin: true` — lets the launcher
   *  nest this view under its owning plugin's row instead of listing it flat. */
  pluginName?: string
  /** Optional agent-context resource carried when this view is dragged to chat. */
  resourceUri?: string
}

/**
 * A resolved customizable rail entry, flattened from a section / view / action by
 * the shell. The rail renders these in the middle zone (bar) or the overflow menu
 * per the persisted layout; each is drag-reorderable, hideable, and pinnable.
 */
export interface RailEntry {
  id: string
  icon: ReactNode
  label: string
  active: boolean
  /** Same shape as `RailAction.onClick` — a flattened action keeps its press origin. */
  onClick: (event?: { clientX: number; clientY: number }) => void
  chordId?: string
  /** Contributed by a PLUGIN — rendered under the overflow menu's "Capabilities" group,
   *  separate from the built-in Views. Still pinnable/hideable/reorderable. */
  plugin?: boolean
  /** The plugin's package name, set alongside `plugin: true`. */
  pluginName?: string
  resourceUri?: string
}

/** A plain action button in the rail — fires a callback instead of toggling a panel/view. */
export interface RailAction {
  id: string
  icon: ReactNode
  label: string
  /**
   * The click handler. The event is passed through because a few actions animate out of the point
   * that was pressed — the appearance cycle reveals the new theme from there — and a handler that
   * only knows "it was clicked" has no origin to animate from. Most actions ignore it.
   */
  onClick: (event?: { clientX: number; clientY: number }) => void
  /** Highlights the button like an active section (e.g. its panel is open elsewhere). */
  active?: boolean
  /** Place in rail — 'top' (with the work views) or 'bottom' (with Settings). Default: 'top'. */
  railPosition?: 'top' | 'bottom'
  /** Hide from the always-visible rail and surface inside the overflow menu instead. */
  overflowGroup?: 'workspace' | 'utilities'
  /** Contributed by a PLUGIN — when customizable, grouped under the overflow menu's
   *  "Capabilities" section instead of the built-in "Views". */
  plugin?: boolean
  /** The plugin's package name, set alongside `plugin: true`. */
  pluginName?: string
  resourceUri?: string
  /** Keybinding-registry command id — its live chord is appended to the tooltip. */
  chordId?: string
  /** When set, this button represents a relocated inspector SECTION: it becomes
   *  draggable so it can be dragged back into the in-panel section row. */
  sectionId?: string
  /** Marks a workspace VIEW toggle (Source Control / Usage / plugin viewlets / …) that
   *  participates in the customizable rail — pinnable/hideable/reorderable — as
   *  opposed to a FIXED global utility (Settings / Reset layout / Keep awake), which
   *  keeps its permanent slot. Default: fixed. */
  customizable?: boolean
  /** For a customizable action, where it defaults before the user moves it. Falls
   *  back to 'overflow' when `overflowGroup` is set, else 'bar'. */
  defaultArea?: RailArea
}

/** Minimal installed-plugin record needed by the workspace launcher. The complete
 * registry and all mutations remain owned by Settings → Plugins. */
export interface PluginSummary {
  name: string
  displayName?: string
  version?: string
  projectId?: string
  enabled: boolean
  error?: string
  /** Exact canonical Settings destination for this installed-plugin row. */
  uiUri: string
}

/** One lightweight entry in the workspace Capabilities catalog. The settings
 * feature remains the owner of editing; the shell only reveals exact targets. */
export interface CapabilitySummary {
  id: string
  label: string
  description?: string
  icon: ReactNode
  /** Exact canonical UI destination opened by the row through the shell navigation port. */
  uiUri: string
  state?: 'enabled' | 'disabled' | 'warning' | 'error' | 'neutral'
  /** Hide the secondary state dot when a primary control already communicates it. */
  hideStatus?: boolean
  /** Optional primary availability control for toggleable capability kinds. */
  enabled?: boolean
  onToggle?: (enabled: boolean) => void | Promise<void>
  /** Canonical resource ref inserted when this item is dropped on the composer. */
  resourceUri?: string
}

/** Extensible capability inventory group. New capability kinds can join the
 * launcher without teaching the shell about their API or settings model. */
export interface CapabilityGroup {
  id: string
  title: string
  items: CapabilitySummary[]
  pending?: boolean
  error?: string | null
  onRetry?: () => void
}
