import { z } from 'zod'

/**
 * A Claude Code agent file read as a record: the fields of its frontmatter Localix keeps and its
 * body. The `name` is Claude Code's, as written; only an ID identifies the agent across runs.
 */
export const agentIdSchema = z.string().min(1).max(200)
export type AgentId = z.infer<typeof agentIdSchema>

/** Claude Code's `name`: what the file declares (sub-agents.md, "Supported frontmatter"). */
export const AGENT_NAME_MAX = 256

export const agentNameSchema = z
  .string()
  .min(1)
  .max(AGENT_NAME_MAX)
  .refine((name) => !name.startsWith('-'), 'A name does not start with "-"')

const agentFields = z.strictObject({
  name: agentNameSchema,
  description: z.string().default(''),
  /** The file's body: the agent's own prompt. */
  instructions: z.string().trim(),
  /** `maxTurns` of the file. */
  maxTurns: z.number().int().positive().optional(),
  /** `skills` of the file: preloaded into the agent's context, never a grant of their tools. */
  skills: z.array(z.string().min(1)).optional(),
})

/** An agent needs instructions to run on. */
function checkAgent(
  value: z.infer<typeof agentFields>,
  ctx: z.core.$RefinementCtx<z.infer<typeof agentFields>>,
): void {
  if (!value.instructions)
    ctx.addIssue({ code: 'custom', message: 'An agent needs instructions', path: ['instructions'] })
}

/** What a file holds. Invocation and access policy belong to the host. */
export const agentFileSchema = agentFields.superRefine(checkAgent)
export type AgentFile = z.infer<typeof agentFileSchema>

/** Registry-issued identity is immutable and is never derived from the name. */
export const agentDefinitionSchema = agentFileSchema.extend({ id: agentIdSchema })
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>

/** Code-shipped identities are stable across installs and independent of session scope. */
export const builtinAgentId = (name: string): AgentId => `builtin:${agentNameSchema.parse(name)}`

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
export const DEFAULT_AGENT_NAME = 'localix'

export const DEFAULT_AGENT_ID: AgentId = builtinAgentId(DEFAULT_AGENT_NAME)
