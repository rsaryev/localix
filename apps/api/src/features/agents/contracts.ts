import { z } from 'zod'
import {
  agentBlueprintSchema,
  agentDefinitionSchema,
  AGENT_HANDLE_PATTERN,
} from '@localixai/agent/agents'

/** A Claude Code agent file read as a record; access rules and identity live outside this value. */
export const agentRecordSchema = agentDefinitionSchema
export type AgentRecord = z.infer<typeof agentRecordSchema>

/** IDs are issued on creation and preserved by updates; callers author behavior only. */
export const agentRecordInputSchema = agentBlueprintSchema.extend({
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
export type ListAgentsResponse = z.infer<typeof listAgentsResponseSchema>

/**
 * Scope selector for the per-name routes. '' / absent = global. A query parameter rather than
 * a path segment because the project id is optional and the name is the resource.
 */
export const agentScopeQuerySchema = z.object({ projectId: z.string().optional() })

/** `POST /:name/duplicate` — the new agent's name; everything else is copied from the source. */
export const duplicateAgentRequestSchema = z.object({
  name: z.string().regex(AGENT_HANDLE_PATTERN),
  projectId: z.string().nullable().optional(),
})
export type DuplicateAgentRequest = z.infer<typeof duplicateAgentRequestSchema>
