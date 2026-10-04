/**
 * Presentation vocabulary for the five agent states.
 *
 * Colors come from the shared `STATUS_TONE_DOT` palette rather than fresh classes, so a green
 * "done" / amber "working" / red "blocked" pip means the same thing here as in the composer strips
 * and the kanban board.
 */
import { STATUS_TONE_DOT, type WorkStatusTone } from '@localixai/kit/status-dot'
import type { AgentState, RosterRow, StateAuthority } from './types'

const STATE_TONE: Record<AgentState, WorkStatusTone> = {
  working: 'running',
  blocked: 'error',
  idle: 'queued',
  done: 'done',
  unknown: 'idle',
}

/**
 * `unconfirmed` draws the state in the tone `unknown` already uses instead of its own.
 *
 * Not a decoration: the manifest's no-match fallback is closer to "nothing was read" than to an
 * observed idle, and the palette already holds exactly one tone for that — so this reuses the
 * vocabulary rather than adding to it. Painting confident info-blue over a state nothing confirmed
 * is the lie worth avoiding, and claude-code makes it the common case, not a corner.
 */
export function stateDotClass(state: AgentState, unconfirmed = false): string {
  return STATUS_TONE_DOT[unconfirmed ? STATE_TONE.unknown : STATE_TONE[state]]
}

/**
 * The glyph's accessible name: the state, and WHERE IT CAME FROM.
 *
 * A state alone is not a claim a reader can weigh. There are four authorities now and they differ in
 * what they prove — our own report protocol says `blocked` outright, a matched screen rule saw
 * something positive, the agent's transcript answers only whether a turn is running, and the
 * manifest's no-match fallback is a guess that says so. The tool has printed the authority since it
 * existed; the workspace named `AUTHORITY_LABEL` and then used it nowhere, so the person next to the
 * terminals had the weakest view of the three.
 *
 * `unconfirmed` keeps its own wording rather than being folded into the authority: it is not a
 * source, it is the absence of one.
 */
export function stateGlyphLabel(
  state: AgentState,
  unconfirmed = false,
  authority?: StateAuthority,
): string {
  if (unconfirmed) {
    return `${STATE_LABEL[state]} — unconfirmed: no manifest rule matched this screen`
  }
  // `none` is a historical row, which draws no glyph at all; naming it would be noise on a surface
  // that never shows it.
  return authority && authority !== 'none'
    ? `${STATE_LABEL[state]} — read from the ${AUTHORITY_LABEL[authority]}`
    : STATE_LABEL[state]
}

/**
 * How each authority reads to a person. It existed, went unused, and was swept away as dead code —
 * correctly, since nothing rendered it. It is here again because the label above now says it.
 */
export const AUTHORITY_LABEL: Record<StateAuthority, string> = {
  'screen-manifest': 'screen manifest',
  transcript: "agent's own transcript",
  none: 'no live observer',
}

export const STATE_LABEL: Record<AgentState, string> = {
  working: 'Working',
  blocked: 'Blocked',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Unknown',
}

/**
 * A row is LIVE when something is currently observing it: either a terminal hosts it, or a state
 * authority spoke for it. `authority === 'none'` is exactly the backend's marker for "historical
 * session found on disk", so this is a read of the contract and not a heuristic.
 */
export function isLive(row: Pick<RosterRow, 'authority' | 'terminalId'>): boolean {
  return row.terminalId != null || row.authority !== 'none'
}
