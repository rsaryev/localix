import { builtinAgentId, type AgentBlueprint } from '@localixai/agent/agents'
import type { AgentRecord } from './contracts'

export const builtin = (definition: AgentBlueprint): AgentRecord => ({
  ...definition,
  id: builtinAgentId(definition.handle),
})
