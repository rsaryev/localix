import { railViewletRegistry, workItemKindRegistry } from '@/shared/contrib/uiContrib'
import type { StandaloneAppSource } from './standaloneApps'

/**
 * The app a tab can become: its mini app's, whichever of that mini app's tabs it is.
 *
 * An app is a whole mini app opened on its main screen (the rail entry it contributes), so a board
 * and a task card of the same mini app offer the same app, named and drawn like that screen. A core
 * tab (a chat, a file, a terminal) and a mini app without a screen of its own offer none.
 */
export function standaloneAppSourceForKind(kind: string): StandaloneAppSource | null {
  const miniApp = workItemKindRegistry.get(kind)?.miniAppName
  if (!miniApp) return null
  const screen = railViewletRegistry.list().find((viewlet) => viewlet.miniAppName === miniApp)
  if (!screen) return null
  return { miniApp, title: screen.title }
}
