import { lazy, Suspense } from 'react'
import { Blocks } from 'lucide-react'
import type { MiniAppUiHost, StatusItemState } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { ModPaneTabs } from './model/ModPaneTabs'
import { MOD_PANE_KIND } from './model/paneTabs'
import { useModSession } from './model/useModSession'

const ModsAbovePromptLazy = lazy(() =>
  import('./ui/ModsAbovePrompt').then((module) => ({ default: module.ModsAbovePrompt })),
)

/** The band above the prompt box: loads with the composer, draws only when a mod does. */
function ModsAbovePromptSlot(props: {
  sessionId: string | null
  context?: { isFocused?: boolean }
}) {
  return (
    <Suspense fallback={null}>
      <ModsAbovePromptLazy {...props} />
    </Suspense>
  )
}

const ModPaneBodyLazy = lazy(() =>
  import('./ui/ModPaneBody').then((module) => ({ default: module.ModPaneBody })),
)

function ModPaneContent(props: {
  item: { id: string; title: string; payload?: Record<string, unknown> }
}) {
  return (
    <Suspense fallback={<LoadingHint>Opening the pane…</LoadingHint>}>
      <ModPaneBodyLazy {...props} />
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

/**
 * Claude Code mods: each pane a mod opens is a workspace tab of its own, and the band above the
 * message box is a strip of the composer's header stack. Which mods are installed, and what each
 * hooks, is in Settings → Plugins.
 */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  host.workItems.register({
    kind: MOD_PANE_KIND,
    Component: ModPaneContent,
    Icon: Blocks,
    restorable: true,
    // Panes are app-wide: each names the project its mod runs in.
    scope: 'global',
  })
  host.statusItems.register({
    id: 'mods:status',
    placement: 'composer',
    useItem: useModsStatusItem,
  })
  // Keeps the pane tabs in step with the panes; one mounted instance does the work.
  host.sessionSurfaces.register({ surface: 'chat.background', Component: ModPaneTabs })
  // Claude Code's `AbovePrompt` site: a strip in the composer's header stack.
  host.sessionSurfaces.register({ surface: 'composer.header', Component: ModsAbovePromptSlot })
}
