import type { ModPaneRef } from '@/shared/api/modsApi'
import { inspector } from '@/shared/lib/inspectorBus'
import { pluginSettingsAnchor } from '@/shared/lib/settingsAnchors'
import { navigateSettings } from '@/shared/lib/settingsNavBus'

/**
 * A mod's pane is a workspace tab of its own (`mod-pane`), one per pane: the tabs mirror the panes
 * the server lists. A pane a mod opens gets a tab in the background; one it asks forward
 * (`$.ui.open({ focus: true })`) opens focused; a tab whose pane is gone — closed by its mod, or
 * restored after a reload with no pane behind it — closes. The person closing a tab is the person
 * closing the pane (`ui.close`), which a mod may refuse: the tab is held shut until the mod has
 * answered, and comes back if the pane is still open.
 */

export const MOD_PANE_KIND = 'mod-pane'

export interface ModPaneTabPayload {
  instance: string
  paneId: string
  plugin: string
}

export const modPaneTabId = (pane: Pick<ModPaneRef, 'instance' | 'id'>) =>
  `${MOD_PANE_KIND}:${pane.instance}/${pane.id}`

export function modPaneTabPayload(payload: Record<string, unknown> | undefined) {
  const { instance, paneId, plugin } = payload ?? {}
  return typeof instance === 'string' && typeof paneId === 'string'
    ? { instance, paneId, plugin: typeof plugin === 'string' ? plugin : '' }
    : null
}

export interface PaneTabPlan {
  open: Array<{ pane: ModPaneRef; focus: boolean }>
  close: string[]
}

export function planPaneTabs(input: {
  panes: readonly ModPaneRef[]
  /** The ids of the `mod-pane` tabs open now. */
  openTabs: readonly string[]
  /** Panes asked forward since the last read (`paneFocus.take`). */
  asked: readonly ModPaneRef[]
  /** Tabs the person is closing, until the mod answers. */
  held: ReadonlySet<string>
}): PaneTabPlan {
  const open = new Set(input.openTabs)
  const asked = new Set(input.asked.map(modPaneTabId))
  const listed = new Set(input.panes.map(modPaneTabId))
  return {
    open: input.panes.flatMap((pane): PaneTabPlan['open'] => {
      const id = modPaneTabId(pane)
      if (asked.has(id)) return [{ pane, focus: true }]
      return open.has(id) || input.held.has(id) ? [] : [{ pane, focus: false }]
    }),
    close: input.openTabs.filter((id) => !listed.has(id)),
  }
}

/** Settings → Plugins, on one plugin's row: from a pane's header and its tab's menu. */
export function openPluginSettings(plugin: string): void {
  inspector.openSettings()
  navigateSettings('plugins', pluginSettingsAnchor(plugin))
}
