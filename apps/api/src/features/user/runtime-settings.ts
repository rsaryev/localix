import type { UserProfileRepository } from './repository'
import { normalizeAgentSettings, type AgentSettings } from './contracts'

/** Read normalized global runtime settings without putting personal data into prompts. */
export async function loadUserSettingsContext(
  repo: UserProfileRepository,
  userId: string,
): Promise<{ agentSettings: AgentSettings | null }> {
  const row = await repo.getRaw(userId)
  if (!row) return { agentSettings: null }
  let agentSettings: AgentSettings | null = null
  if (row.agent_settings) {
    try {
      agentSettings = normalizeAgentSettings(JSON.parse(row.agent_settings) as unknown)
    } catch (err) {
      // Falling back to defaults is right — a run must not die on one bad column — but
      // it is invisible from the outside: Settings keeps showing the stored value while
      // every run ignores it. Name the row so the mismatch is explicable.
      console.warn(`[user-profile] agent_settings for ${userId} is unreadable; using defaults`, err)
    }
  }
  return { agentSettings }
}
