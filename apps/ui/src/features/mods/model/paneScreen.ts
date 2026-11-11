import {
  focusedVisibleTabId,
  groupViewModel,
  leaves,
  scopedViewRoot,
  type GridStore,
} from '@/entities/workspace-grid/model'
import type { ModPaneOnScreen, ModPanesOnScreen } from '@/shared/api/modsApi'
import { MOD_PANE_KIND, modPaneTabPayload } from './paneTabs'

/**
 * Which pane tabs the grid shows: each group's visible tab that is a mod's pane, and the focused
 * group's when it is one. The server answers `$.ui.panes()`'s `isShown` and `isFocused` by it.
 */
export function panesOnScreen(state: GridStore): ModPanesOnScreen {
  const paneOf = (tabId: string | null): ModPaneOnScreen[] => {
    const item = tabId ? state.items[tabId] : undefined
    const ref = item?.kind === MOD_PANE_KIND ? modPaneTabPayload(item.payload) : null
    return ref ? [{ instance: ref.instance, id: ref.paneId }] : []
  }
  return {
    shown: leaves(scopedViewRoot(state)).flatMap((leaf) =>
      paneOf(
        groupViewModel(leaf, state.items, state.activeScope, state.warmScopes, state.scopeActiveTab)
          .visibleActive,
      ),
    ),
    focused: paneOf(focusedVisibleTabId(state))[0] ?? null,
  }
}
