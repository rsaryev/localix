import type { PersistedMessage } from '../contracts'

import { RECAP_AFTER_MS, RECAP_MIN_TURNS } from '../../../contracts/session-recap'

export { RECAP_AFTER_MS, RECAP_MIN_TURNS }

export type RecapTrigger = 'auto' | 'command'
export type RecapSkip = 'disabled' | 'running' | 'too-few-turns' | 'too-soon' | 'already-recapped'

/** A turn is a reply the person can read: not a divider, a command's output or a hidden run. */
function isFinishedTurn(row: PersistedMessage): boolean {
  const { payload } = row
  return (
    payload.role === 'assistant' &&
    !payload.uiOnly &&
    !payload.isInternal &&
    !payload.systemNotice &&
    !payload.commandOutput
  )
}

const isRecap = (row: PersistedMessage): boolean =>
  row.payload.systemNotice?.kind === 'session_recap'

/** The position of the last row `match` accepts, or -1. */
function lastIndexWhere(
  rows: readonly PersistedMessage[],
  match: (row: PersistedMessage) => boolean,
) {
  for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i]!)) return i
  return -1
}

/**
 * Whether a recap should be written now, from the transcript, the clock and the person's switch.
 *
 * Automatic: switched on, no turn running, at least three finished turns, three minutes since the
 * last one, and no recap since it (so never twice in a row). On demand (`/recap`): any session
 * with a finished turn and no turn running; the switch, the delay and the repeat rule are for the
 * automatic one alone. `rows` is the active branch, oldest first; `nowMs` is the injected clock.
 */
export function recapEligibility(input: {
  trigger: RecapTrigger
  enabled: boolean
  running: boolean
  nowMs: number
  rows: readonly PersistedMessage[]
}): { ok: true } | { ok: false; reason: RecapSkip } {
  const auto = input.trigger === 'auto'
  if (auto && !input.enabled) return { ok: false, reason: 'disabled' }
  if (input.running) return { ok: false, reason: 'running' }
  const turns = input.rows.filter(isFinishedTurn)
  if (turns.length < (auto ? RECAP_MIN_TURNS : 1)) return { ok: false, reason: 'too-few-turns' }
  if (!auto) return { ok: true }
  const last = turns[turns.length - 1]!
  if (lastIndexWhere(input.rows, isRecap) > input.rows.lastIndexOf(last))
    return { ok: false, reason: 'already-recapped' }
  if (input.nowMs - Date.parse(last.updatedAt) < RECAP_AFTER_MS)
    return { ok: false, reason: 'too-soon' }
  return { ok: true }
}
