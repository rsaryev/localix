/**
 * The External Agents quick-action menu, as DATA.
 *
 * Pure on purpose. Every rule below is a UX decision with a failure mode behind it, and a decision
 * that only exists inside a React hook is one nobody can check:
 *
 *  - an agent that is NOT installed is not listed at all. It used to be listed, and clicking it
 *    opened a pane that printed `command not found` — an error report delivered by opening a
 *    window. A menu of six things where one works is not a menu;
 *  - "checking" is a row, not an absence. A menu that renders empty for 200 ms and then fills reads
 *    as broken to anyone who opens it quickly;
 *  - a machine with NO agent CLI gets a sentence saying so, not an empty submenu. The absence is
 *    the answer, and it needs to be said;
 *  - "Check again" is always reachable except while a check is running, because the one state this
 *    cache is knowably wrong in — someone just installed a CLI — is invisible from here.
 */
import { RefreshCw, Users } from 'lucide-react'
import type { IconComponent, MenuEntry } from '@localixai/plugin-sdk/ui'
import { statusMenuList } from '@localixai/plugin-sdk/ui'

import type { AgentCliStatus } from './types'
import type { LauncherState } from './launcherStore'

/** A disabled row is still a row: the type wants a handler, and this is the one that does nothing. */
const NOTHING = () => {}

export interface QuickActionsInput {
  readonly state: LauncherState
  /** Provider glyphs, so a launcher row is identifiable without reading it. */
  readonly marks: Readonly<Record<string, IconComponent>>
  readonly onOpenRoster: () => void
  readonly onLaunch: (launcher: AgentCliStatus) => void
  readonly onRecheck: () => void
  /** Open an agent's install page. Offered only when NO agent CLI is installed. */
  readonly onInstall?: (launcher: AgentCliStatus) => void
}

/** The installed ones, in the catalog's own order — never re-sorted by what happens to be here. */
export function availableLaunchers(state: LauncherState): readonly AgentCliStatus[] {
  return state.launchers.filter((launcher) => launcher.available)
}

export function agentQuickActions(input: QuickActionsInput): MenuEntry[] {
  const { state, marks, onOpenRoster, onLaunch, onRecheck, onInstall } = input
  const available = availableLaunchers(state)
  const checking = state.status === 'loading' || state.status === 'idle'

  const entries: MenuEntry[] = [
    { id: 'open', label: 'Open External Agents', icon: Users, onSelect: onOpenRoster },
    { separator: true },
  ]

  if (available.length > 0) {
    /**
     * A HEADER over flat rows, where this used to push the same rows behind a `Launch in terminal ▸`
     * trigger. The reason for the group was sound and still holds — directly under "Open External
     * Agents", a bare "Codex" reads as "open Codex's sessions" exactly as easily as "run Codex",
     * and only the group's name settles which. What was wrong was paying a hover and a second
     * panel for a title: a header says the same word in the same place and the rows stay one click
     * away, which is what a QUICK action means.
     */
    entries.push(
      ...statusMenuList({
        header: 'Launch in terminal',
        items: available,
        // The catalog is small and every row is a different program — folding any of it away would
        // hide an agent behind a count.
        limit: available.length,
        row: (launcher) => ({
          id: `launch:${launcher.provider}`,
          label: launcher.label,
          ...(marks[launcher.provider] ? { icon: marks[launcher.provider]! } : {}),
          onSelect: () => onLaunch(launcher),
        }),
      }),
    )
  } else if (checking) {
    entries.push({
      id: 'checking',
      label: 'Checking for installed agent CLIs…',
      disabled: true,
      onSelect: NOTHING,
    })
  } else if (state.status === 'error') {
    // The backend's own sentence, not a restatement of it. `errorDetail` stays off the line.
    entries.push({
      id: 'error',
      label: state.error ?? 'Could not check for installed agent CLIs.',
      disabled: true,
      onSelect: NOTHING,
    })
  } else {
    entries.push({
      id: 'none',
      label: 'No agent CLIs found on PATH',
      disabled: true,
      onSelect: NOTHING,
    })
    // The sentence alone was a dead end. Each agent's own install page is the way out; after
    // installing, "Check again" below picks it up.
    const installable = onInstall ? state.launchers.filter((launcher) => launcher.installUrl) : []
    if (installable.length > 0) {
      entries.push(
        ...statusMenuList({
          header: 'Install an agent CLI',
          items: installable,
          limit: installable.length,
          row: (launcher) => ({
            id: `install:${launcher.provider}`,
            label: launcher.label,
            ...(marks[launcher.provider] ? { icon: marks[launcher.provider]! } : {}),
            onSelect: () => onInstall!(launcher),
          }),
        }),
      )
    }
  }

  // Offered even mid-check, but disabled — the row must not appear and disappear under the cursor.
  entries.push(
    { separator: true },
    {
      id: 'recheck',
      label: 'Check again',
      icon: RefreshCw,
      disabled: checking,
      onSelect: onRecheck,
    },
  )

  return entries
}
