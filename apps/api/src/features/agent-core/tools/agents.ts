import { z } from 'zod'
import {
  agentAuthoredBatchSchema,
  agentAuthoredBlueprintSchema,
  defineAgentTool,
  type AgentAuthoredBlueprint,
  type CallClass,
} from '@localixai/agent/agents'
import { TOOL } from '../tool-names'

export interface CatalogAgent {
  id: string
  handle: string
  description: string
  enabled: boolean
  canJoinConversation: boolean
  scope: 'project' | 'global'
  leadershipPriority: number
}

/**
 * Bound by the host to the user, current registry and speaking agent.
 *
 * `list` stays beside the agent directory in context: without it a leader created new specialists
 * instead of reusing listed ones (LOCALIX-168). A per-agent `get` added nothing a choice needs.
 */
export interface AgentsToolPort {
  list(): Promise<CatalogAgent[]>
  create(
    toolCallId: string,
    inputs: AgentAuthoredBlueprint[],
  ): Promise<{
    created: CatalogAgent[]
    errors: { index: number; handle: string; code: string; message: string }[]
  }>
}

/** One authored specialist as the model writes it: snake_case, like every model-facing field. */
const authored = agentAuthoredBlueprintSchema.shape
// A specialist outlives the task that created it, so it is named and described as a profession:
// `limassol_landing_design` was a role filed under one project's city and page (LOCALIX-168).
const authoredAgentWire = z.strictObject({
  handle: authored.handle.describe(
    'The role as a profession, reusable in any project: designer, backend, qa. Never a project, place, client or task name.',
  ),
  description: authored.description.describe('What the role does, in general terms.'),
  instructions: authored.instructions.describe('Standing instructions, reusable across tasks.'),
  leadership_priority: authored.leadershipPriority.describe(
    'Integer −2…2; lower than the current leader for a supporting role.',
  ),
})

// One flat object, not a union: providers flatten `oneOf` badly and models then send wrong shapes.
// A batch sent as a JSON string is parsed by the runtime's argument coercion, which needs a plain
// object schema (`vendor/pi` delta); a union defeated it.
export const agentsToolInputSchema = z.strictObject({
  action: z.enum(['list', 'create']),
  agents: z
    .array(authoredAgentWire)
    .min(1)
    .max(8)
    .optional()
    .describe(
      'Only for action "create": 1–8 specialists, each {handle, description, instructions, leadership_priority}.',
    ),
})
type AgentsInput = z.infer<typeof agentsToolInputSchema>

/** The wire batch as the registry's blueprints, validated as one team before anything is saved. */
export function authoredBlueprints(
  agents: readonly z.infer<typeof authoredAgentWire>[],
): AgentAuthoredBlueprint[] {
  return agentAuthoredBatchSchema.parse(
    agents.map(({ leadership_priority, ...agent }) => ({
      ...agent,
      leadershipPriority: leadership_priority,
    })),
  )
}

export function classifyAgentsCall(input: unknown): CallClass {
  const action = input && typeof input === 'object' ? (input as { action?: unknown }).action : null
  if (action === 'list') return { effect: 'read' }
  if (action === 'create') return { effect: 'host' }
  return { effect: 'external' }
}

/** Persistent specialists, independent of the fork tool's parallel copies and runs. */
export function createAgentsTool(port: AgentsToolPort) {
  return defineAgentTool<AgentsInput>({
    name: TOOL.agents,
    label: 'Agents',
    activeVerb: 'Managing agents',
    description:
      'List the specialists in this chat’s registry, or create a reusable specialist when none fits. ' +
      'Create supplies agents: an array of 1–8 specialists, each with handle, description, instructions and leadership_priority. The host copies your saved permission policy without temporary grants. ' +
      'Creation saves a permanent agent; it does not invite or start it. To work together, @mention its handle in your reply with a concrete assignment: it joins and answers. ' +
      'Reuse existing specialists. Keep task-specific details and private chat data out of standing instructions. Parallel copies of yourself belong to fork.',
    inputSchema: agentsToolInputSchema,
    mutates: true,
    classify: classifyAgentsCall,
    permissionResources: (input) => [agentsToolInputSchema.parse(input).action],
    executionMode: 'sequential',
    executionModeFor: (input) =>
      classifyAgentsCall(input).effect === 'read' ? 'parallel' : 'sequential',
    async execute(toolCallId, raw) {
      // Validate direct host invocations too; no unchecked fields may reach the authoring port.
      const input = agentsToolInputSchema.parse(raw)
      if (input.action === 'list') return { content: JSON.stringify({ agents: await port.list() }) }
      if (!input.agents) {
        throw new Error(
          'create requires "agents": [{handle, description, instructions, leadership_priority}]',
        )
      }
      const result = await port.create(toolCallId, authoredBlueprints(input.agents))
      return {
        content: JSON.stringify({
          status: result.errors.length ? (result.created.length ? 'partial' : 'failed') : 'created',
          ...result,
        }),
        ...(result.created.length ? {} : { isError: true }),
      }
    },
  })
}
