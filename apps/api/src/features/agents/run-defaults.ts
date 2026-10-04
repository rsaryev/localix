import type { AgentRecord } from './contracts'

/** Authored execution defaults. Tool authority is resolved separately by Capabilities. */
export function agentRunDefaults(record: AgentRecord) {
  return {
    prompt: record.instructions,
    preferredProvider: record.modelPreference?.provider,
    preferredModel: record.modelPreference?.model,
    preferredEffort: record.modelPreference?.effort,
    maxTurns: record.limits?.maxTurns,
    pinnedSkills: record.context?.preloadSkills,
  }
}
