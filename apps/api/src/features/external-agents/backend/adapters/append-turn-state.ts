import { tailTurnState, TURN_TAIL_BYTES } from '../live/turn-state'
import { jsonlRecords } from './fs-read'
import type { AdapterEnv, SourceRef } from './types'

/**
 * See `ProviderAdapter.readTurnState`: a format that appends (Claude Code, Codex, GitHub Copilot),
 * so its last records answer.
 */
export async function readAppendedTurnState(ref: SourceRef, _env: AdapterEnv, now: number) {
  return tailTurnState(
    ref.sourcePath,
    TURN_TAIL_BYTES,
    ref.updatedAtHint ?? now,
    now,
    (path, bytes) => jsonlRecords(path, bytes, { fromEnd: true }),
  )
}
