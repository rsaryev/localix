import { useGridStore } from './store'
import { groupOfTab } from './itemOps'

/**
 * Close a WorkItem tab anywhere in the grid by id — the toggle-off half of every
 * "rail/header button that opens a panel". Finds the leaf that hosts the tab and
 * closes it; a no-op when the id isn't open. Lives in the model (not in a single
 * caller) so the left rail AND the breadcrumb trailing actions share one closer.
 */
export function closeGridTab(id: string): void {
  const leaf = groupOfTab(useGridStore.getState().root, id)
  if (leaf) useGridStore.getState().closeTab(leaf.id, id)
}
