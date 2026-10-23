import { lazy, Suspense } from 'react'
import { Blocks } from 'lucide-react'
import type { MiniAppUiHost, StatusItemState } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { useModSession } from './model/useModSession'

const ModsWorkspaceLazy = lazy(() =>
  import('./ui/ModsWorkspace').then((module) => ({ default: module.ModsWorkspace })),
)

function ModsWorkspaceBody() {
  return (
    <Suspense fallback={<LoadingHint>Opening mods…</LoadingHint>}>
      <ModsWorkspaceLazy />
    </Suspense>
  )
}

/**
 * The conversation's mods at its prompt box: their status lines (`$.ui.status`) as one item, and
 * the drafts and suggestions they put in the box, applied as the composer renders.
 */
function useModsStatusItem(sessionId: string | null): StatusItemState | null {
  const lines = Object.entries(useModSession(sessionId))
  if (lines.length === 0) return null
  return {
    label: lines.map(([plugin, text]) => `${plugin}: ${text}`).join('\n'),
    Icon: Blocks,
    text: lines.map(([, text]) => text).join(' · '),
  }
}

let registered = false

/** Claude Code mods: the panes they open, in one app-wide tab. */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  host.workItems.register({
    kind: 'mods',
    Component: ModsWorkspaceBody,
    Icon: Blocks,
    restorable: true,
    scope: 'global',
  })
  host.statusItems.register({
    id: 'mods:status',
    placement: 'composer',
    useItem: useModsStatusItem,
  })
  host.railViewlets.register({
    kind: 'mods',
    title: 'Mods',
    label: 'Mods — panes Claude Code mods open',
    toolCategory: 'utilities',
    // Out of the bar until a mod is installed: most people never load one.
    defaultArea: 'overflow',
    keywords: ['mods', 'mod', 'hooks module', 'claude code', 'pane', 'plugin'],
    Icon: Blocks,
  })
}
