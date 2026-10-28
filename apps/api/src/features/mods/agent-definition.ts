import { z } from 'zod'
import { pluginAgentSchema } from '../plugins/contracts-agents'
import { buildLoadedAgent, type LoadedPluginAgent } from '../plugins/loader-contract'

/**
 * `$.agent.register`'s spec as an agent definition: the fields of an agent file, which the mod
 * writes as an object. It becomes the plugin agent Localix runs as it runs one from a plugin's
 * `agents/` folder (`tools`, `disallowedTools`, `maxTurns`, `skills`, `memory`,
 * `background`, `isolation`, `omitClaudeMd`, `autoCompactWindow`, `initialPrompt`), so every
 * field takes effect when a child runs as it (`agents/delegation.ts` resolves it). `model` and
 * `effort` are accepted, as Claude Code's files carry them, and not read: the person chooses.
 *
 * Claude Code leaves `permissionMode`, `mcpServers` and `hooks` of a plugin's agent out of force,
 * and a mod is a plugin: they are kept on the spec, never applied. `isolation: 'remote'` is a
 * cloud session Localix does not have, and refuses.
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

/** The fields a definition holds that Localix keeps and does not apply. */
const NOT_APPLIED = ['permissionMode', 'mcpServers', 'hooks'] as const

export interface ModAgentDefinition {
  agent: LoadedPluginAgent
  /** The spec's fields that are kept and not applied (`NOT_APPLIED`). */
  notApplied: string[]
}

/** The definition of `spec` for `plugin`; throws the schema's reason when it refuses it. */
export function modAgentDefinition(plugin: string, spec: unknown): ModAgentDefinition {
  const parsed = specSchema.safeParse(spec)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`agent.register: ${issue.path.join('.') || 'spec'}: ${issue.message}`)
  }
  const fields = parsed.data
  const agent = pluginAgentSchema.parse({
    name: fields.name,
    description: fields.description,
    prompt: fields.prompt,
    ...(fields.tools ? { tools: [...fields.tools] } : {}),
    ...(fields.disallowedTools ? { disallowedTools: [...fields.disallowedTools] } : {}),
    ...(fields.maxTurns ? { maxTurns: fields.maxTurns } : {}),
    ...(fields.autoCompactWindow ? { autoCompactWindow: fields.autoCompactWindow } : {}),
    ...(fields.skills ? { pinnedSkills: [...fields.skills] } : {}),
    ...(fields.initialPrompt ? { initialPrompt: fields.initialPrompt } : {}),
    ...(fields.memory ? { memory: fields.memory } : {}),
    ...(fields.background ? { background: true } : {}),
    ...(fields.omitClaudeMd ? { omitClaudeMd: true } : {}),
    ...(fields.isolation ? { isolation: 'isolated' } : {}),
  })
  return {
    agent: buildLoadedAgent(plugin, agent, (text) => text),
    notApplied: NOT_APPLIED.filter((key) => fields[key] !== undefined),
  }
}
