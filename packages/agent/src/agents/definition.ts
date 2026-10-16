import { z } from 'zod'
import { isReasoningEffort } from '../types'

/** Handles address a definition within a catalog; only IDs identify it across runs. */
export const AGENT_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/i

/**
 * THE PERSON'S OWN ADDRESS IN A CONVERSATION — and the handle of the built-in `human` record.
 *
 * FIXED, not the person's name. A handle has to be known to the participants before they speak,
 * and it lives in their CACHED prompt prefix; keying it to a display name would put a mutable value
 * in the one place a mutable value costs the whole cache. What the person is called and does lives
 * on the `human` record (label, description, instructions) and is rendered in the volatile tail.
 */
export const HUMAN_HANDLE = 'human'

/**
 * EVERY PARTICIPANT AT ONCE.
 *
 * Not a way to be heard by more people — the person's message already reaches everyone — but a
 * way to SAY SO: "@all, in one line each" puts every participant at the head of the order.
 */
export const ALL_MENTION_HANDLE = 'all'

/** The person's description and instructions together; they ride in every prompt's tail. */
export const HUMAN_PROFILE_MAX_CHARS = 1000

const RESERVED_HANDLES: readonly string[] = [HUMAN_HANDLE, ALL_MENTION_HANDLE]
const isReservedHandle = (handle: string) => RESERVED_HANDLES.includes(handle.toLowerCase())

/** A handle's spelling, reserved or not. */
const handleFormatSchema = z.string().regex(AGENT_HANDLE_PATTERN)

/**
 * No agent may answer to a reserved address. Owned here, by the definition, because every agent —
 * built-in, the user's, a plugin's — is parsed through this schema: an agent handled `all` or
 * `human` would be either unaddressable or routed in the person's place. Only the `human` record
 * itself carries `human` (see {@link agentBlueprintSchema}).
 */
export const agentHandleSchema = handleFormatSchema.refine((handle) => !isReservedHandle(handle), {
  message: 'This handle is reserved for the conversation (`@human`, `@all`)',
})
export const agentIdSchema = z.string().min(1).max(200)
export type AgentId = z.infer<typeof agentIdSchema>

export const agentModelPreferenceSchema = z.strictObject({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().refine(isReasoningEffort, 'Unknown reasoning effort').optional(),
})

export const agentContextSchema = z.strictObject({
  /** Loading context never grants permission to use a skill's tools. */
  preloadSkills: z.array(z.string().min(1)).optional(),
  memory: z.strictObject({ scope: z.enum(['global', 'project', 'session']) }).optional(),
})

/** `agent` runs; `human` is the person's own record — described, never run. Absent = agent. */
export type AgentKind = 'agent' | 'human'

const agentBlueprintFields = z.strictObject({
  kind: z.enum(['agent', 'human']).optional(),
  handle: handleFormatSchema,
  label: z.string().min(1).max(60).optional(),
  description: z.string().default(''),
  instructions: z.string().trim(),
  /** Small hierarchy signal. It elects a room leader; it is not a general routing override. */
  leadershipPriority: z.number().int().min(-2).max(2).default(0),
  modelPreference: agentModelPreferenceSchema.optional(),
  limits: z.strictObject({ maxTurns: z.number().int().positive().optional() }).optional(),
  context: agentContextSchema.optional(),
})

/**
 * The two kinds share one record so the person's profile uses the agents' storage, scopes and
 * Restore. A `human` record describes the person and nothing else: no run settings, no hierarchy.
 */
function checkKind(
  value: z.infer<typeof agentBlueprintFields>,
  ctx: z.core.$RefinementCtx<z.infer<typeof agentBlueprintFields>>,
): void {
  const issue = (message: string, path: string) =>
    ctx.addIssue({ code: 'custom', message, path: [path] })
  if (value.kind !== 'human') {
    if (isReservedHandle(value.handle))
      issue('This handle is reserved for the conversation (`@human`, `@all`)', 'handle')
    if (!value.instructions) issue('An agent needs instructions', 'instructions')
    return
  }
  if (value.handle !== HUMAN_HANDLE) issue('The human record is handled `human`', 'handle')
  if (value.leadershipPriority !== 0)
    issue('The human has no hierarchy priority', 'leadershipPriority')
  for (const field of ['modelPreference', 'limits', 'context'] as const)
    if (value[field] !== undefined) issue('The human has no run settings', field)
  if (value.description.length + value.instructions.length > HUMAN_PROFILE_MAX_CHARS)
    issue(
      `Description and instructions together stay within ${HUMAN_PROFILE_MAX_CHARS} characters`,
      'instructions',
    )
}

/** Portable authored behavior. Invocation and access policy belong to the host. */
export const agentBlueprintSchema = agentBlueprintFields.superRefine(checkKind)
export type AgentBlueprint = z.infer<typeof agentBlueprintSchema>

/** The behavior an agent may author; identity, policy and run settings remain host-owned. */
export const agentAuthoredBlueprintSchema = agentBlueprintFields
  .pick({ handle: true, description: true, instructions: true, leadershipPriority: true })
  .extend({
    handle: agentHandleSchema.pipe(z.string().max(100)),
    description: z.string().trim().min(1).max(2000),
    instructions: z.string().trim().min(1).max(64000),
    leadershipPriority: z.number().int().min(-2).max(2),
  })
export type AgentAuthoredBlueprint = z.infer<typeof agentAuthoredBlueprintSchema>

/** Validate the entire team before publication; every member has an explicit hierarchy value. */
export const agentAuthoredBatchSchema = z
  .array(agentAuthoredBlueprintSchema)
  .min(1)
  .max(8)
  .refine(
    (agents) => new Set(agents.map((agent) => agent.handle.toLowerCase())).size === agents.length,
    'Each agent in the batch must have a distinct handle',
  )

/** Registry-issued identity is immutable and is never derived from the display handle. */
export const agentDefinitionSchema = agentBlueprintSchema.extend({ id: agentIdSchema })
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>

/** Code-shipped identities are stable across installs and independent of session scope. */
export const builtinAgentId = (handle: string): AgentId =>
  `builtin:${handleFormatSchema.parse(handle)}`

/**
 * The agent that always exists — and therefore the one every answer is keyed to.
 *
 * Permission rules belong to an agent and to nothing else, so "what may this installation do"
 * is not a question that can be asked on its own: it is "what may THIS agent do". Work that
 * runs before or beside a turn — loading plugins, listing skills for `/skill`, the effective
 * configuration report — asks about this one. It cannot be deleted (`agents/service.ts`
 * refuses), which is what makes it safe to depend on rather than a default that might be
 * missing.
 */
export const DEFAULT_AGENT_HANDLE = 'localix'

export const DEFAULT_AGENT_ID: AgentId = builtinAgentId(DEFAULT_AGENT_HANDLE)

/** The person's built-in record: shipped, overridable, never deleted, never run. */
export const HUMAN_AGENT_ID: AgentId = builtinAgentId(HUMAN_HANDLE)

export const isHumanAgent = (record: { kind?: AgentKind }): boolean => record.kind === 'human'
