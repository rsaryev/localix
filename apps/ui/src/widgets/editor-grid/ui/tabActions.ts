import { sessionOfScope, type WorkItem } from '@/entities/workspace-grid/model'
import { openNewTerminal, restartTerminalTab } from '@/features/terminal/model/terminalTabs'
import { MOD_PANE_KIND, modPaneTabPayload, openPluginPage } from '@/features/mods/model/paneTabs'

/** A "create another tab of this kind" action, surfaced in the tab CONTEXT MENU.
 *  Lives in the widget layer — the place allowed to know about features — so the
 *  agnostic grid model never learns about terminals. Returns null for kinds with
 *  no in-grid creation affordance (files come from the tree, diffs from
 *  source-control, etc.).
 *
 *  It used to render as a trailing "+" in the strip as well, with a chevron beside
 *  it listing contributed terminal profiles. Both are gone: the chevron's entries
 *  resolved through `useUiNavigation`, which dropped the profile's command, so all
 *  six opened a plain shell — and the pair only appeared while a terminal tab was
 *  active, which made the agent launchers vanish the moment a file was opened. The
 *  launchers now live in the titlebar, where they do not come and go. */
export interface NewTabAction {
  label: string
  run: () => void
}

export function newTabActionFor(item: WorkItem | undefined): NewTabAction | null {
  if (item?.kind === 'terminal') {
    // The new terminal joins the chat the clicked tab belongs to — its scope, which every
    // session tab carries. A terminal tab with no chat offers no sibling rather than guessing one.
    const sessionId = sessionOfScope(item.scope)
    if (!sessionId) return null
    return {
      label: 'New Terminal',
      run: () => void openNewTerminal(sessionId),
    }
  }
  return null
}

/** Dead processes keep their output briefly; restart belongs to the tab menu, alongside Close. */
export function restartTabActionFor(item: WorkItem | undefined): NewTabAction | null {
  if (item?.kind !== 'terminal' || !item.payload?.terminalExit) return null
  return {
    label: 'Restart terminal',
    run: () => {
      void restartTerminalTab(item.id)
    },
  }
}

/** A mod pane's tab: "Open in the Store" opens the page of the plugin whose mod opened it. */
export function modPaneSettingsAction(item: WorkItem | undefined): NewTabAction | null {
  const plugin = item?.kind === MOD_PANE_KIND ? modPaneTabPayload(item.payload)?.plugin : null
  return plugin ? { label: 'Open in the Store', run: () => openPluginPage(plugin) } : null
}
