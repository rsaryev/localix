// Terminals as first-class grid WorkItems. There is NO separate terminal tab
// manager any more — each terminal is a normal grid tab, so multiple terminals are
// just multiple tabs, "split" is the grid's native drag-to-another-group, and the
// per-session view comes from the grid's scope filter (terminal tabs are scoped to
// their owning chat session, like files/diffs).
//
// One concept end-to-end: a terminal tab ALWAYS corresponds to a backend PTY by id.
//  - `id` is `terminal:<backendTerminalId>` so re-opening the same PTY reveals the
//    existing tab instead of duplicating it.
//  - `owned` marks a terminal the USER created here (closing its tab kills the PTY);
//    adopted terminals (agent jobs, dev servers) are owned by their launcher, so
//    closing the tab only detaches — the process keeps running.
import { useGridStore, groupOfTab, scopeOf, type WorkItem } from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { createTerminal } from '../api'
import { decideAutoReveal } from './terminalAutoReveal'
import { applyTerminalState } from './terminalStates'

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

function makeItem(args: {
  sessionId: string
  terminalId: string
  owned: boolean
  title: string
}): WorkItem {
  return {
    kind: 'terminal',
    id: `terminal:${args.terminalId}`,
    title: args.title,
    scope: args.sessionId,
    payload: { sessionId: args.sessionId, terminalId: args.terminalId, owned: args.owned },
  }
}

/** Open `item` as a terminal tab: reveal it if already open, else dock it into the
 *  terminal role group. `reveal:false` adds it hidden (used to pre-attach a dev
 *  server before the user looks at it). */
function placeTerminal(item: WorkItem, opts?: { reveal?: boolean }): void {
  const grid = useGridStore.getState()
  const already = groupOfTab(grid.root, item.id)
  const group = already ? already.id : grid.resolveRoleGroup('terminal')
  grid.openItem(item, { group, activate: opts?.reveal !== false })
}

/** Create a backend PTY for the session and open it as a new (owned) terminal tab. */
export async function openNewTerminal(sessionId: string): Promise<void> {
  let info: Awaited<ReturnType<typeof createTerminal>>
  try {
    info = await createTerminal({ sessionId })
  } catch (err) {
    // Nothing opens when the spawn fails, so there is no pane left to report it — the earlier
    // "the pane surfaces connection errors" was wrong in exactly the case that matters: the
    // person pressed New terminal (or Recover, on a dead one) and the app did nothing at all.
    toast.error('Could not start a terminal', { description: errorMessage(err, '') || undefined })
    return
  }
  const n = terminalsInScope(sessionId).length
  placeTerminal(
    makeItem({
      sessionId,
      terminalId: info.id,
      owned: true,
      title: n === 0 ? 'Terminal' : `Terminal ${n + 1}`,
    }),
  )
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
  let terminalId: string
  try {
    ;({ terminalId } = await backendClient.spawnTerminalCommand({ sessionId, command }))
  } catch (err) {
    toast.error(`Could not start “${title}”`, { description: errorMessage(err, '') || undefined })
    return
  }
  placeTerminal(makeItem({ sessionId, terminalId, owned: true, title }))
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
  reveal?: boolean
}): void {
  placeTerminal(
    makeItem({
      sessionId: args.sessionId,
      terminalId: args.terminalId,
      owned: false,
      title: args.title ?? 'Task',
    }),
    { reveal: args.reveal },
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
    reveal: true,
  })
}

// Last-seen alt-screen flag per live PTY, kept PER SESSION: each call carries one session's whole
// live set and the decision replaces the observations it was given. One shared map was safe only
// while a single focused-session poll fed it; with pushed state from every watched session, one
// session's call would drop another's observations and re-reveal a tab the person had closed.
const altScreenSeen = new Map<string, Map<string, boolean>>()

/** Adopt + reveal any tab-less PTY that a FULL-SCREEN app just took over
 *  (alt-screen enter, detected server-side) — an unseen full-screen app is
 *  unusable. Edge-triggered via {@link decideAutoReveal}: closing the revealed
 *  tab is respected until the app leaves and re-enters the alt screen. Fed with
 *  the session's every live PTY row by `terminalStates.ts` (push + backstop poll). */
export function autoRevealFullScreenTerminals(
  sessionId: string,
  rows: ReadonlyArray<{ terminalId: string; command?: string; altScreen: boolean }>,
): void {
  const items = useGridStore.getState().items
  const decision = decideAutoReveal(
    altScreenSeen.get(sessionId) ?? new Map(),
    rows.map((r) => ({ id: r.terminalId, altScreen: r.altScreen })),
    (id) => !!items[`terminal:${id}`],
  )
  if (decision.next.size > 0) altScreenSeen.set(sessionId, decision.next)
  else altScreenSeen.delete(sessionId)
  for (const id of decision.reveal) {
    const row = rows.find((r) => r.terminalId === id)
    adoptTerminal({ terminalId: id, sessionId, title: row?.command ?? 'Terminal', reveal: true })
  }
}

/** A pushed `terminal.state` frame: record it, and reveal a takeover in the same tick. */
export function routeTerminalState(
  sessionId: string,
  event: Parameters<typeof applyTerminalState>[1],
): void {
  autoRevealFullScreenTerminals(sessionId, applyTerminalState(sessionId, event))
}
