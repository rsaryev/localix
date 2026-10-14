import { createElement } from 'react'
import { capabilityResourceUri } from '@localixai/plugin-sdk/navigation'
import { closeGridTab, isTabOpenedAs, useGridStore } from '@/features/workspace-grid/model'
import { resolveViewIcon } from '@/features/inspector/ui/viewIcon'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'
import type { PluginViewSpec } from '@/shared/api/contracts'
import type { RailAction } from '@/widgets/workspace-shell'

interface PluginViewRailActionArgs {
  view: PluginViewSpec
  /** The focused group's visible active tab — the button is "active" when it is this view. */
  focusedActiveId: string | null
  /** The chat the page has open: a plugin view is a tab of ONE chat, and it opens in this one. */
  openSessionId: string | null
  capabilityScope: string
  /** Runs the open/close as a workspace-view gesture (closes the mobile drawer first). */
  run: (action: () => void) => void
}

/**
 * The rail button of one installed third-party plugin VIEW: opens its bridged iframe as an
 * editor-grid tab of the open chat, or closes it when it is the focused tab.
 *
 * A plugin view is one tab per chat, its id qualified by that chat (`tabIdInScope`), so "is this
 * the focused tab" matches the id as opened rather than the bare id — and an open names the chat,
 * since the grid refuses a session tab opened without one. With no chat open it says so.
 */
export function pluginViewRailAction({
  view,
  focusedActiveId,
  openSessionId,
  capabilityScope,
  run,
}: PluginViewRailActionArgs): RailAction {
  const tabId = `plugin-view:${view.fullName}`
  const isActive = focusedActiveId !== null && isTabOpenedAs(focusedActiveId, tabId)
  return {
    id: `view:${view.fullName}`,
    icon: createElement(resolveViewIcon(view.icon), { className: 'size-4.5' }),
    label: `${view.title} (${view.pluginName} plugin)`,
    active: isActive,
    customizable: true,
    defaultArea: 'overflow',
    // Installed third-party view — grouped under "Plugins" in the overflow.
    plugin: true,
    pluginName: view.pluginName,
    resourceUri: capabilityResourceUri({
      kind: 'view',
      id: view.fullName,
      scope: capabilityScope,
      label: view.title,
      description: `View contributed by ${view.pluginName}`,
      enabled: true,
    }),
    onClick: () =>
      run(() => {
        if (isActive && focusedActiveId) {
          closeGridTab(focusedActiveId)
          return
        }
        const sessionId = requireOpenChat(openSessionId)
        if (!sessionId) return
        useGridStore.getState().openItem({
          kind: 'plugin-view',
          id: tabId,
          title: view.title,
          scope: sessionId,
          payload: { pluginName: view.pluginName, projectId: view.projectId, viewId: view.id },
        })
      }),
  }
}
