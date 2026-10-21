// Terminals as first-class grid WorkItems. There is NO separate terminal tab
// manager any more — each terminal is a normal grid tab, so multiple terminals are
// just multiple tabs in the main column, and the
// per-session view comes from the grid's scope filter (terminal tabs are scoped to
// their owning chat session, like files/diffs).
//
// One concept end-to-end: a terminal tab ALWAYS corresponds to a backend PTY by id.
//  - `id` is `terminal:<backendTerminalId>` so re-opening the same PTY reveals the
//    existing tab instead of duplicating it.
//  - `owned` marks a terminal the USER created here (closing its tab kills the PTY);
//    adopted terminals (agent jobs, dev servers) are owned by their launcher, so
//    closing the tab only detaches — the process keeps running.
import { useGridStore, groupOfTab, scopeOf, type WorkItem } from '@/entities/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { createTerminal } from '../api'
import { makeTerminalItem, placeTerminal } from './terminalTabPlacement'

export { restartTerminalTab } from './restartTerminalTab'

// Every terminal belongs to the chat that opened it: its PTY runs in that chat's workspace and
// its tab lives in that chat's scope. A terminal opened with no chat used to land in the shared
// global scope, unbound, in $HOME — visible from every chat, owned by none.

function terminalsInScope(sessionId: string): WorkItem[] {
  // A sub-session's terminals open in its root's workspace (`resolveOpenScope`).
  const scope = workspaceOf(sessionId)
  return Object.values(useGridStore.getState().items).filter(
    (i) => i.kind === 'terminal' && scopeOf(i.scope) === scope,
  )
}

/** Create a backend PTY for the session and open it as a new (owned) terminal tab. */
export async function openNewTerminal(sessionId: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof createTerminal>>
  try {
    info = await createTerminal({ sessionId })
  } catch (err) {
    // Nothing opens when the spawn fails, so there is no pane left to report it — the earlier
    // "the pane surfaces connection errors" was wrong in exactly the case that matters: the
    // person pressed New terminal (or Recover, on a dead one) and the app did nothing at all.
    toast.error('Could not start a terminal', { description: errorMessage(err, '') || undefined })
    return false
  }
  const n = terminalsInScope(sessionId).length
  placeTerminal(
    makeTerminalItem({
      sessionId,
      terminalId: info.id,
      cwd: info.cwd,
      owned: true,
      title: n === 0 ? 'Terminal' : `Terminal ${n + 1}`,
    }),
  )
  return true
}

/**
 * Run a program in a fresh pane and open it as an OWNED terminal tab — a terminal PROFILE.
 *
 * Deliberately knows nothing about what it runs. The command arrives from whoever registered the
 * UI location or core shortcut that resolved here. The terminal owns process placement,
 * while callers choose the program and its label.
 *
 * Owned, unlike an adopted dev-server pane: the user picked this profile from the tab strip and the
 * tab IS the program, so closing the tab must end it rather than leave a full-screen TUI running
 * with nothing on screen pointing at it.
 *
 * A missing binary is NOT a failure here: the pane opens and the login shell says "command not
 * found" in it, which names the actual problem. A rejected spawn is different — no pane opens, so
 * the report is the only thing the person gets.
 */
export async function openCommandTerminal(
  sessionId: string,
  command: string,
  title: string,
): Promise<void> {
  let info: Awaited<ReturnType<typeof backendClient.spawnTerminalCommand>>
  try {
    info = await backendClient.spawnTerminalCommand({ sessionId, command })
  } catch (err) {
    toast.error(`Could not start “${title}”`, { description: errorMessage(err, '') || undefined })
    return
  }
  placeTerminal(
    makeTerminalItem({
      sessionId,
      terminalId: info.terminalId,
      cwd: info.cwd,
      owned: true,
      title,
      command,
    }),
  )
}

/** Reveal the session's most-recently-opened terminal, creating one if it has none. */
export function revealOrCreateTerminal(sessionId: string): void {
  const terms = terminalsInScope(sessionId)
  const last = terms[terms.length - 1]
  if (last) {
    const leaf = groupOfTab(useGridStore.getState().root, last.id)
    if (leaf) {
      // setActiveTab focuses the group too (sets activeGroup + bumps the MRU), so a
      // separate setActiveGroup would just be a second, redundant store write.
      useGridStore.getState().setActiveTab(leaf.id, last.id)
      return
    }
  }
  void openNewTerminal(sessionId)
}

/** Attach to an EXISTING backend PTY (an agent job / dev server) as a terminal tab.
 *  Not owned — closing the tab leaves the process running. Re-adopting the same id
 *  just reveals the existing tab. */
export function adoptTerminal(args: {
  terminalId: string
  sessionId: string
  title?: string
  command?: string
  cwd?: string
}): void {
  const grid = useGridStore.getState()
  const id = `terminal:${args.terminalId}`
  const retained = grid.items[id] ?? grid.closed.find((entry) => entry.item.id === id)?.item
  placeTerminal(
    retained ??
      makeTerminalItem({
        sessionId: args.sessionId,
        terminalId: args.terminalId,
        owned: false,
        title: args.title ?? 'Task',
        command: args.command,
        cwd: args.cwd,
      }),
  )
}

/** Reveal one exact PTY referenced by an event/resource deep-link.
 * Existing items retain their ownership metadata; a missing item is safely
 * re-attached as adopted because the Event Center never owns the backend process. */
export function revealTerminal(args: {
  terminalId: string
  sessionId: string
  title?: string
}): void {
  const grid = useGridStore.getState()
  const itemId = `terminal:${args.terminalId}`
  const existing = grid.items[itemId]
  const leaf = existing ? groupOfTab(grid.root, itemId) : null
  if (leaf) {
    grid.setActiveTab(leaf.id, itemId)
    return
  }
  adoptTerminal({
    terminalId: args.terminalId,
    sessionId: args.sessionId,
    title: args.title ?? 'Terminal event',
  })
}

/** A user-launched agent pane belongs to its Localix session, including when reopened. */
export function openOwnedTerminal(sessionId: string, terminalId: string, title: string): void {
  placeTerminal(makeTerminalItem({ sessionId, terminalId, title, owned: true }))
}
