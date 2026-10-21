import { loadUserSettingsContext } from '../../user/runtime-settings'
import type { UserProfileRepository } from '../../user/repository'
import type { AgentSettings } from '../../user/contracts'

/**
 * This user's agent settings (Settings → *), or `null` when they have no profile
 * row, the row has none, or it cannot be read.
 *
 * `loadUserSettingsContext` owns the column, the JSON encoding, and the malformed-JSON
 * fallback; this degrades a failed read to `null` for the service layer's callers.
 */
export function readAgentSettings(
  userProfileRepo: UserProfileRepository,
  userId: string,
): Promise<AgentSettings | null> {
  return (
    loadUserSettingsContext(userProfileRepo, userId)
      .then((ctx) => ctx.agentSettings)
      // Both former call sites degraded a failed read to "no settings" rather than
      // failing the command; keep that (a DB error must not break /skills or titling).
      .catch(() => null)
  )
}
