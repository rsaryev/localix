import { useMemo } from 'react'
import { Users } from 'lucide-react'
import type { StatusItemState } from '@localixai/plugin-sdk/ui'
import { pluginExternal, pluginTerminal, pluginWorkspace, toast } from '@localixai/plugin-sdk/ui'
import { usePluginWorkspace } from '@localixai/plugin-sdk/ui/runtime-hooks'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { EXTERNAL_AGENTS_KIND } from './model/openSession'
import { AGENT_MARKS, agentLaunchCommand } from './model/agentLaunchers'
import { refreshAgentLaunchers, useAgentLaunchers } from './model/launcherStore'
import { agentQuickActions } from './model/quickActions'
import type { AgentCliStatus } from './model/types'

/**
 * External Agents in the TITLEBAR — the one place the agent quick actions live.
 *
 * WHY HERE, and only here. The launchers used to hang off the tab strip's "+", behind a chevron
 * that appeared only while a terminal tab happened to be active: open a file and the way to start
 * an agent vanished, which is the opposite of what a quick action is. The titlebar does not come
 * and go with the work item on screen, the host already gives a status item a tooltip, a focus
 * ring, a keyboard-navigable menu and a compact mode for a narrow window, and the whole thing costs
 * ONE glyph — so the header carries a launcher list without carrying a launcher bar.
 *
 * NO `onClick`. With a declared menu and no primary action the host opens the MENU on a left click
 * (see `shared/ui/status-item.tsx`), which is what makes a single obvious press reach every action
 * the item has. The previous item opened the roster on click and hid its launchers behind a
 * right-click nobody discovers.
 *
 * Deliberately WITHOUT a live indicator, and that is still the interesting decision. A count of
 * running agents is exactly what this seam was built for — but reading it means scanning several
 * history roots on disk, forever, so a number can sit in the chrome. The launcher check is a
 * different animal: it reads PATH, is cached behind a TTL on the server and once in this process,
 * and is asked once per app session rather than on a poll.
 *
 * Every action acts for THIS item's chat (`sessionId`): the roster opens in it and an agent starts
 * in its terminal. Outside a chat there is neither, so there is no item.
 */
export function useExternalAgentsStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = usePluginWorkspace()
  const focusedId = workspace.focusedId
  const active = focusedId ? workspace.items[focusedId]?.kind === EXTERNAL_AGENTS_KIND : false
  const launchers = useAgentLaunchers()

  const menu = useMemo(
    () =>
      sessionId === null
        ? []
        : agentQuickActions({
            state: launchers,
            marks: AGENT_MARKS,
            onOpenRoster: () =>
              pluginWorkspace.openWorkItem({
                workKind: EXTERNAL_AGENTS_KIND,
                id: EXTERNAL_AGENTS_KIND,
                title: 'External Agents',
                scope: sessionId,
              }),
            onLaunch: (launcher) => launch(sessionId, launcher),
            onRecheck: refreshAgentLaunchers,
            onInstall: (launcher) => {
              if (launcher.installUrl) void pluginExternal.open(launcher.installUrl)
            },
          }),
    [launchers, sessionId],
  )

  if (sessionId === null) return null
  return {
    label: 'External agents — launch a CLI or open the roster',
    Icon: Users,
    active,
    // The host swaps its spinner in while the machine is being checked, so the menu is never the
    // first thing that tells you something is happening.
    busy: launchers.status === 'loading',
    menu,
  }
}

/**
 * Start one agent in a terminal pane.
 *
 * The executable is passed BARE (see `shared/launch.ts`) even though the probe resolved an absolute
 * path: the pane runs under the user's login shell, and running the shim it would have picked is
 * the whole point. The probe decides whether to OFFER the launcher, never what to run.
 *
 * The pane is opened for the item's OWN chat — the `sessionId` the host handed `useItem`. A session
 * is what gives the terminal a project directory; the launch used to read the active chat at click
 * time, which is not the chat whose titlebar was clicked whenever the two differ, and with none it
 * ran the agent in whatever directory the API process happens to sit in.
 *
 * A rejected spawn is the one failure with nothing on screen to explain it — no pane opens — so it
 * is the one that must be said out loud.
 */
function launch(sessionId: string, launcher: AgentCliStatus): void {
  void pluginTerminal
    .spawnCommand({
      command: agentLaunchCommand({
        provider: launcher.provider,
        executable: launcher.executable,
      }),
      sessionId,
      title: launcher.label,
    })
    .catch((error: unknown) => {
      toast.error(`Could not start ${launcher.label}`, {
        description: errorMessage(error, '') || undefined,
      })
    })
}
