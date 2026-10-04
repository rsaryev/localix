import { create } from 'zustand'

import type { AgentStreamEvent } from '@/shared/api/contracts'

/**
 * WHAT EACH LIVE TERMINAL IS DOING — taken over by a full-screen app, serving a URL — per session.
 *
 * Two writers, one truth. The server PUSHES a `terminal.state` frame the moment a pane enters or
 * leaves the alternate screen or its served URL changes, and the composer's registry poll
 * (`useTerminalLiveness`) replaces the whole set as a slow backstop: it is the only source of a
 * URL found by the OS port scan for a server that printed no banner, and of the baseline after a
 * reconnect. Both writers return the session's resulting set, which their callers hand to the same
 * full-screen auto-reveal (`terminalTabs.ts`), so a takeover is revealed in the tick it happens
 * instead of on the next poll. Pure store: no grid, no reveal, so the rule below is testable alone.
 *
 * A poll answer can be OLDER than a push that landed while it was in flight; it must not roll the
 * pushed state back (an alt-screen flag going true → false → true would re-reveal a tab the person
 * closed). So a row pushed after the poll was REQUESTED keeps its pushed value.
 */
export interface TerminalStateRow {
  terminalId: string
  command?: string
  altScreen: boolean
  previewUrl?: string
}

type StateEvent = Extract<AgentStreamEvent, { type: 'terminal.state' }>

interface TerminalStatesStore {
  bySession: Readonly<Record<string, readonly TerminalStateRow[]>>
}

export const useTerminalStatesStore = create<TerminalStatesStore>(() => ({ bySession: {} }))

/** terminalId → epoch ms of its latest push, for the stale-poll rule above. */
const pushedAt = new Map<string, number>()

function setRows(
  sessionId: string,
  rows: readonly TerminalStateRow[],
): readonly TerminalStateRow[] {
  useTerminalStatesStore.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: rows } }))
  return rows
}

const rowsOf = (sessionId: string) => useTerminalStatesStore.getState().bySession[sessionId] ?? []

/** The registry poll's answer: the session's whole live set, requested at `requestedAt`. */
export function replaceTerminalStates(
  sessionId: string,
  rows: readonly TerminalStateRow[],
  requestedAt: number,
): readonly TerminalStateRow[] {
  const fresh = (id: string) => (pushedAt.get(id) ?? 0) > requestedAt
  const current = new Map(rowsOf(sessionId).map((row) => [row.terminalId, row]))
  const next = rows.map((row) => {
    const pushed = current.get(row.terminalId)
    return pushed && fresh(row.terminalId) ? pushed : row
  })
  const answered = new Set(rows.map((row) => row.terminalId))
  for (const [id, row] of current) {
    if (answered.has(id)) continue
    // Absent from the answer: spawned after the snapshot (pushed since — keep it), or gone.
    if (fresh(id)) next.push(row)
    else pushedAt.delete(id)
  }
  return setRows(sessionId, next)
}

/** A pushed `terminal.state` frame: upsert that one row, last wins. */
export function applyTerminalState(
  sessionId: string,
  event: StateEvent,
): readonly TerminalStateRow[] {
  pushedAt.set(event.terminalId, Date.now())
  const row: TerminalStateRow = {
    terminalId: event.terminalId,
    altScreen: event.altScreen,
    ...(event.command ? { command: event.command } : {}),
    ...(event.previewUrl ? { previewUrl: event.previewUrl } : {}),
  }
  const rows = rowsOf(sessionId)
  const at = rows.findIndex((r) => r.terminalId === event.terminalId)
  return setRows(sessionId, at < 0 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r)))
}

/** The PTY exited (`terminal.finished`): its URL and takeover go with it, now. */
export function forgetTerminalState(sessionId: string, terminalId: string): void {
  pushedAt.delete(terminalId)
  const rows = rowsOf(sessionId)
  if (!rows.some((r) => r.terminalId === terminalId)) return
  useTerminalStatesStore.setState((s) => ({
    bySession: { ...s.bySession, [sessionId]: rows.filter((r) => r.terminalId !== terminalId) },
  }))
}
