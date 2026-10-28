import { z } from 'zod'
import { agentDefinitionSchema, agentFileSchema } from '@localixai/agent/agents'

/** A Claude Code agent file read as a record; access rules and identity live outside this value. */
export const agentRecordSchema = agentDefinitionSchema
export type AgentRecord = z.infer<typeof agentRecordSchema>

/** IDs are issued on creation and preserved by updates; callers author behavior only. */
export const agentRecordInputSchema = agentFileSchema.extend({
  projectId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})
export type AgentRecordInput = z.infer<typeof agentRecordInputSchema>

/** One catalog entry returned to the UI: definition + enable-state + where it comes from. */
export const agentSummarySchema = z.object({
  record: agentRecordSchema,
  /** '' = global; otherwise the project id. */
  projectId: z.string(),
  scope: z.enum(['global', 'project']),
  enabled: z.boolean(),
  invocations: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])),
  /** 'builtin', 'managed', 'project', 'user' or `plugin:<name>`: where the definition comes from. */
  source: z.string(),
  /** Absolute path of the agent file; '' for a plugin's or a built-in type. */
  path: z.string(),
  /** A file the person owns: its Definition is saved in place. The rest is copied to Yours. */
  editable: z.boolean(),
})
export type AgentSummary = z.infer<typeof agentSummarySchema>

export const listAgentsResponseSchema = z.object({ agents: z.array(agentSummarySchema) })
