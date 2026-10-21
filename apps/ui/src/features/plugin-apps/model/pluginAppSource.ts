import { railViewletRegistry, workItemKindRegistry } from '@/shared/contrib/uiContrib'
import type { PluginAppSource } from './pluginApps'

/**
 * The app a tab can become: its plugin's, whichever of that plugin's tabs it is.
 *
 * An app is a whole plugin opened on its main screen (the rail entry it contributes), so a board
 * and a task card of the same plugin offer the same app, named and drawn like that screen. A core
 * tab (a chat, a file, a terminal) and a plugin without a screen of its own offer none.
 */
export function pluginAppSourceForKind(kind: string): PluginAppSource | null {
  const plugin = workItemKindRegistry.get(kind)?.pluginName
  if (!plugin) return null
  const screen = railViewletRegistry.list().find((viewlet) => viewlet.pluginName === plugin)
  if (!screen) return null
  return { plugin, title: screen.title, Icon: screen.Icon }
}
