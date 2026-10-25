import { z } from 'zod'
import { isReasoningEffort } from '../types'

/** Handles address a definition within a catalog; only IDs identify it across runs. */
export const AGENT_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/i

/**
 * EVERY PARTICIPANT AT ONCE.
 *
 * Not a way to be heard by more people — the person's message already reaches everyone — but a
 * way to SAY SO: "@all, in one line each" puts every participant at the head of the order.
 */
export const ALL_MENTION_HANDLE = 'all'

const RESERVED_HANDLES: readonly string[] = [ALL_MENTION_HANDLE]
const isReservedHandle = (handle: string) => RESERVED_HANDLES.includes(handle.toLowerCase())

/** A handle's spelling, reserved or not. */
const handleFormatSchema = z.string().regex(AGENT_HANDLE_PATTERN)

/**
 * No agent may answer to a reserved address. Owned here, by the definition, because every agent —
 * built-in, the user's, a plugin's — is parsed through this schema: an agent handled `all` would be
 * unaddressable. The person has no address at all; they are reached through `ask`.
 */
export const agentHandleSchema = handleFormatSchema.refine((handle) => !isReservedHandle(handle), {
  message: 'This handle is reserved for the conversation (`@all`)',
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

const agentBlueprintFields = z.strictObject({
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

/** An agent has a reserved-free handle and instructions to run on. */
function checkAgent(
  value: z.infer<typeof agentBlueprintFields>,
  ctx: z.core.$RefinementCtx<z.infer<typeof agentBlueprintFields>>,
): void {
  if (isReservedHandle(value.handle))
    ctx.addIssue({
      code: 'custom',
      message: 'This handle is reserved for the conversation (`@all`)',
      path: ['handle'],
    })
  if (!value.instructions)
    ctx.addIssue({ code: 'custom', message: 'An agent needs instructions', path: ['instructions'] })
}

/** Portable authored behavior. Invocation and access policy belong to the host. */
export const agentBlueprintSchema = agentBlueprintFields.superRefine(checkAgent)
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
