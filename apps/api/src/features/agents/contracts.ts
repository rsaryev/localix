import { z } from 'zod'
import {
  agentBlueprintSchema,
  agentDefinitionSchema,
  AGENT_HANDLE_PATTERN,
} from '@localixai/agent/agents'

/** Native definition; registry state and adapter provenance live outside this value. */
export const agentRecordSchema = agentDefinitionSchema
export type AgentRecord = z.infer<typeof agentRecordSchema>

/** IDs are issued on creation and preserved by updates; callers author behavior only. */
export const agentRecordInputSchema = agentBlueprintSchema.extend({
  projectId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})
export type AgentRecordInput = z.infer<typeof agentRecordInputSchema>

/** One materialized registry entry returned to the UI: definition + enable-state + provenance. */
export const agentSummarySchema = z.object({
  record: agentRecordSchema,
  /** '' = global; otherwise the project id. */
  projectId: z.string(),
  scope: z.enum(['global', 'project']),
  enabled: z.boolean(),
  invocations: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])),
  /** 'builtin' (served from code), 'local' (authored here) or `imported:<sourceId>`. */
  source: z.string(),
  /** Absolute path of the definition file on disk; '' for a builtin with no override. */
  path: z.string(),
  /**
   * A system definition exists under this name. With `source: 'builtin'` the record IS that
   * definition; with any other source the user's file overrides it and can be reset.
   */
  builtin: z.boolean().default(false),
  /** Registration ownership belongs to the catalog, never to the authored definition. */
  registration: z
    .strictObject({
      sourceId: z.string(),
      sourceName: z.string(),
      key: z.string(),
      revision: z.number().int().nonnegative(),
    })
    .optional(),
  unavailableReason: z.enum(['source_disabled', 'policy_pending']).optional(),
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
