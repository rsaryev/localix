import { z } from 'zod'

/** Handles address a definition within a catalog; only IDs identify it across runs. */
export const AGENT_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/i

/**
 * THE PERSON'S OWN ADDRESS IN A CONVERSATION.
 *
 * A conversation has one participant nobody could address: the human. Agents could hand work to
 * each other and could answer the person, but they had no way to say "this one is for you" — so a
 * question meant for the person was a sentence the next participant answered on their behalf.
 *
 * FIXED, not the person's name. A handle has to be known to the participants before they speak,
 * and it lives in their CACHED prompt prefix; keying it to a display name would put a mutable value
 * in the one place a mutable value costs the whole cache. `user` is what every model has already
 * read a million times.
 */
export const USER_MENTION_HANDLE = 'user'

/**
 * EVERY PARTICIPANT AT ONCE.
 *
 * Not a way to be heard by more people — the person's message already reaches everyone — but a
 * way to SAY SO: "@all, in one line each" puts every participant at the head of the order.
 */
export const ALL_MENTION_HANDLE = 'all'

/**
 * No agent may answer to a reserved address. Owned here, by the definition, because every agent —
 * built-in, the user's, a plugin's — is parsed through this schema: an agent handled `all` or
 * `user` used to be accepted and was then either unaddressable or routed in the person's place.
 */
export const agentHandleSchema = z
  .string()
  .regex(AGENT_HANDLE_PATTERN)
  .refine(
    (handle) => {
      const lower = handle.toLowerCase()
      return lower !== USER_MENTION_HANDLE && lower !== ALL_MENTION_HANDLE
    },
    { message: 'This handle is reserved for the conversation (`@user`, `@all`)' },
  )
export const agentIdSchema = z.string().min(1).max(200)
export type AgentId = z.infer<typeof agentIdSchema>

export const agentModelPreferenceSchema = z.strictObject({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
})

export const agentContextSchema = z.strictObject({
  /** Loading context never grants permission to use a skill's tools. */
  preloadSkills: z.array(z.string().min(1)).optional(),
  memory: z.strictObject({ scope: z.enum(['global', 'project', 'session']) }).optional(),
})

/** Portable authored behavior. Invocation and access policy belong to the host. */
export const agentBlueprintSchema = z.strictObject({
  handle: agentHandleSchema,
  label: z.string().min(1).max(60).optional(),
  description: z.string().default(''),
  instructions: z.string().trim().min(1),
  /** Small hierarchy signal. It elects a room leader; it is not a general routing override. */
  leadershipPriority: z.number().int().min(-2).max(2).default(0),
  modelPreference: agentModelPreferenceSchema.optional(),
  limits: z.strictObject({ maxTurns: z.number().int().positive().optional() }).optional(),
  context: agentContextSchema.optional(),
})
export type AgentBlueprint = z.infer<typeof agentBlueprintSchema>

/** Registry-issued identity is immutable and is never derived from the display handle. */
export const agentDefinitionSchema = agentBlueprintSchema.extend({ id: agentIdSchema })
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>

/** Code-shipped identities are stable across installs and independent of session scope. */
export const builtinAgentId = (handle: string): AgentId =>
  `builtin:${agentHandleSchema.parse(handle)}`

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
