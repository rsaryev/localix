import type { ReactNode } from 'react'
import type { PluginCategory } from '@localixai/mini-app-sdk/manifest'
import type { RailArea } from '../model/railLayout'

/** A section that slides open in the sidebar panel (history, files, etc.) */
export interface RailSection {
  /** Opts a built-in destination into the shared tool catalog without plugin ownership. */
  toolCategory?: PluginCategory
  id: string
  icon: ReactNode
  label: string
  content: ReactNode
  /** False for a core destination that must remain visible in the middle rail group. */
  customizable?: boolean
  /** Where this section defaults in the CUSTOMIZABLE rail before the user moves
   *  it — 'bar' (always visible) or 'overflow' (in the "…" menu). Default 'bar'. */
  defaultArea?: RailArea
  /** Plugin ownership, independent of grouping and pin placement. */
  plugin?: boolean
  /** The plugin's package name, used to look up its manifest category. */
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
  /** Optional readable name when placed in the horizontal status bar. */
  statusLabel?: string
  toolCategory?: PluginCategory
  id: string
  icon: ReactNode
  label: string
  active: boolean
  /** Same shape as `RailAction.onClick` — a flattened action keeps its press origin. */
  onClick: (event?: { clientX: number; clientY: number }) => void
  chordId?: string
  /** Plugin ownership, independent of grouping and pin placement. */
  plugin?: boolean
  /** The plugin's package name, set alongside `plugin: true`. */
  pluginName?: string
  resourceUri?: string
  /** Extra rows for the button's context menu, after the rail's own (an app action, …). */
  extraMenu?: readonly RailMenuItem[]
}

export interface RailMenuItem {
  id: string
  label: string
  onSelect: () => void
}

/** A plain action button in the rail — fires a callback instead of toggling a panel/view. */
export interface RailAction {
  statusLabel?: string
  /** Opts a built-in destination into the shared tool catalog without plugin ownership. */
  toolCategory?: PluginCategory
  id: string
  icon: ReactNode
  label: string
  /**
   * The click handler. The optional press origin is preserved for actions that use it.
   */
  onClick: (event?: { clientX: number; clientY: number }) => void
  /** Highlights the button like an active section (e.g. its panel is open elsewhere). */
  active?: boolean
  /** Place in rail — 'top' (with the work views) or 'bottom' (with Settings). Default: 'top'. */
  railPosition?: 'top' | 'bottom'
  /** Hide from the always-visible rail and surface inside the overflow menu instead. */
  overflowGroup?: 'workspace' | 'utilities'
  /** Plugin ownership, independent of grouping and pin placement. */
  plugin?: boolean
  /** The plugin's package name, set alongside `plugin: true`. */
  pluginName?: string
  resourceUri?: string
  extraMenu?: readonly RailMenuItem[]
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
