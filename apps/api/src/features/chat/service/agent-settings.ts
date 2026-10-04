import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db'
import { loadUserProfileContext } from '../../agent-core/tools/memory/user-profile'
import { createUserProfileRepository } from '../../user/repository'
import type { AgentSettings } from '../../user/contracts'

/**
 * This user's agent settings (Settings → *), or `null` when they have no profile
 * row, the row has none, or it cannot be read.
 *
 * The chat SERVICE layer needs these in two places (the workload model routes for
 * titling/improve-prompt, and the skill overrides the `/skills` listing renders)
 * but — unlike the RUNTIME layer, which is handed a `userProfileRepo` — it only
 * carries a raw `db`. So both call sites had reached straight past the owner into
 * `user_profiles`, hand-rolling the same select + `JSON.parse`, and had drifted
 * apart doing it (`String(row.agent_settings)` vs `row.agent_settings as string`;
 * one wrapping the query in the try, the other bolting on a separate `.catch`).
 *
 * `loadUserProfileContext` already owns that knowledge — the column, the JSON
 * encoding, and the malformed-JSON fallback — and five chat runtime modules use it.
 * This is the one line of wiring that lets the service layer use it too, so the
 * table's shape stays behind its repository.
 */
export function readAgentSettings(
  db: Kysely<AppDatabase>,
  userId: string,
): Promise<AgentSettings | null> {
  return (
    loadUserProfileContext(createUserProfileRepository(db), userId)
      .then((ctx) => ctx.agentSettings)
      // Both former call sites degraded a failed read to "no settings" rather than
      // failing the command; keep that (a DB error must not break /skills or titling).
      .catch(() => null)
  )
}
