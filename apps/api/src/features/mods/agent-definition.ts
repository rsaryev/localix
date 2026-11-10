import { z } from 'zod'

/**
 * `$.agent.register`'s spec as an agent definition: `name` is the subagent type and the rest is the
 * SDK's `AgentDefinition`, the fields of an agent file written as an object. The agent catalog
 * reads it as Claude Code reads the SDK `agents` option, the `--agents` source
 * (`plugins/kit/agents.ts`), so every field takes effect when a child runs as it. `model` and
 * `effort` are accepted, as Claude Code's files carry them, and not read: the person chooses.
 *
 * `permissionMode`, `mcpServers` and `hooks` apply as they do for an `--agents` agent: hooks and
 * inline servers without the folder's trust. `isolation: 'remote'` is a cloud session Localix does
 * not have, and refuses.
 */

const names = z.array(z.string().min(1)).readonly()

const specSchema = z
  .object({
    name: z.string(),
    description: z.string().min(1),
    prompt: z.string().min(1),
    tools: names.optional(),
    disallowedTools: names.optional(),
    model: z.string().min(1).optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    permissionMode: z.string().optional(),
    mcpServers: z.array(z.unknown()).optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    maxTurns: z.number().int().positive().optional(),
    autoCompactWindow: z.number().int().min(100_000).max(1_000_000).optional(),
    skills: names.optional(),
    initialPrompt: z.string().optional(),
    memory: z.enum(['user', 'project', 'local']).optional(),
    background: z.literal(true).optional(),
    omitClaudeMd: z.literal(true).optional(),
    isolation: z.enum(['worktree']).optional(),
  })
  .strict()

export interface ModAgentDefinition {
  /** The subagent type. */
  name: string
  /** The definition under that name: `description`, `prompt` and the frontmatter fields. */
  definition: Readonly<Record<string, unknown>>
}

/** The definition of `spec`; throws the schema's reason when it refuses it. */
export function modAgentDefinition(spec: unknown): ModAgentDefinition {
  const parsed = specSchema.safeParse(spec)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`agent.register: ${issue.path.join('.') || 'spec'}: ${issue.message}`)
  }
  const { name, ...definition } = parsed.data
  return { name, definition }
}
