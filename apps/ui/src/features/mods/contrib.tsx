import { lazy, Suspense } from 'react'
import { Blocks } from 'lucide-react'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { ModPaneTabs } from './model/ModPaneTabs'
import { MOD_PANE_KIND } from './model/paneTabs'

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

const ModsStatusFooterLazy = lazy(() =>
  import('./ui/ModsStatusFooter').then((module) => ({ default: module.ModsStatusFooter })),
)

/**
 * The status lines under the prompt box. It loads with the composer; it draws only while a source
 * has a line, but it is mounted always: it is also what applies a mod's drafts and suggestions.
 */
function ModsStatusFooterSlot(props: {
  sessionId: string | null
  context?: { hasInteraction?: boolean }
}) {
  return (
    <Suspense fallback={null}>
      <ModsStatusFooterLazy {...props} />
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

let registered = false

/**
 * Claude Code mods: each pane a mod opens is a workspace tab of its own, the band above the
 * message box is a strip of the composer's header stack, and the status lines sit under it. Which
 * mods are installed, and what each hooks, is in the Store.
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
  // Keeps the pane tabs in step with the panes; one mounted instance does the work.
  host.sessionSurfaces.register({ surface: 'chat.background', Component: ModPaneTabs })
  // Claude Code's `AbovePrompt` site: a strip in the composer's header stack.
  host.sessionSurfaces.register({ surface: 'composer.header', Component: ModsAbovePromptSlot })
  // The status lines (the person's `statusLine` and each mod's `$.ui.status`) under the box.
  host.sessionSurfaces.register({ surface: 'composer.footer', Component: ModsStatusFooterSlot })
}
