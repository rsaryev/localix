import type { AgentModelChoice } from '../agent-core/agent-model-route'
import type { UpdateUserProfileRequest, UserProfile } from '../user/contracts'

/**
 * The person's model choices for agents, kept in their profile (`agentSettings.agentModelChoices`).
 * One owner reads and writes them: the Store's agent page and the run's
 * model chain all go through this port.
 */
export interface AgentModelChoicesPort {
  read: (userId: string) => Promise<readonly AgentModelChoice[]>
  write: (userId: string, choices: AgentModelChoice[]) => Promise<void>
}

export function agentModelChoicesPort(profile: {
  getProfile(userId: string): Promise<UserProfile>
  updateProfile(userId: string, patch: UpdateUserProfileRequest): Promise<unknown>
}): AgentModelChoicesPort {
  return {
    read: async (userId) =>
      (await profile.getProfile(userId)).agentSettings?.agentModelChoices ?? [],
    write: async (userId, choices) => {
      await profile.updateProfile(userId, { agentSettingsPatch: { agentModelChoices: choices } })
    },
  }
}
