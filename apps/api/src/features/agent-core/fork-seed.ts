import { zodToJsonSchema } from '@localixai/agent'
import type { AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'

import type { RunProfile } from './run-shape'
import { TOOL } from './tool-names'

/**
 * WHAT A FORK IS SENT THAT ITS PARENT WAS SENT: the system prompt, the tool declarations, and the
 * key the provider's prompt cache is looked up by.
 *
 * Tools come first in every provider's cache prefix, then the system prompt, then the
 * conversation, so a fork reads its parent's cache only if these are the parent's, byte for byte.
 * They cannot be rebuilt from the child's own record: a delegated child's run shape carries other
 * guidance, a closed toolset and other conversation rules than the chat that called it. So the
 * parent's run hands them over at the call (`captureForkSeed`), they are stored with the fork, and
 * every run of the fork is sent them again (`forkToolSurface`).
 *
 * Declarations only. What a tool DOES stays the child's own: it runs in the child's session, with
 * the child's folder, ports and permission gate. A tool the parent was shown that the child cannot
 * run answers with an error instead of vanishing from the list.
 */

/** One tool as the model is shown it. `schema` is the full JSON schema, before compaction. */
export const forkSeedToolSchema = z.object({
  name: z.string(),
  modelName: z.string().optional(),
  description: z.string(),
  schema: z.record(z.string(), z.unknown()),
})
export type ForkSeedTool = z.infer<typeof forkSeedToolSchema>

export const forkSeedSchema = z.object({
  systemPrompt: z.string(),
  tools: z.array(forkSeedToolSchema),
  /** What the provider keys its cache on: the parent's session, not the fork's. */
  cacheSessionId: z.string(),
  /**
   * The names the parent's run held, which decide what its own past tool work is shown as
   * (`participant-audience.ts`): the same names give the same projection of the same rows.
   */
  toolNames: z.array(z.string()),
  /**
   * The parent's run profile: which tools the run holds and how, so the fork can use what the
   * parent could. A child's own profile is a narrower, closed one. Plain data, kept as it was.
   */
  profile: z.custom<RunProfile>((value) => typeof value === 'object' && value !== null),
  promptCacheRetention: z.enum(['short', 'long']).optional(),
})
export type ForkSeed = z.infer<typeof forkSeedSchema>

export interface ForkSeedInput {
  systemPrompt: string
  /** The tools the model is shown, in the order it is shown them. */
  tools: readonly AgentTool[]
  cacheSessionId: string
  toolNames: readonly string[]
  profile: RunProfile
  retention?: 'short' | 'long'
}

export function captureForkSeed(input: ForkSeedInput): ForkSeed {
  return {
    systemPrompt: input.systemPrompt,
    tools: input.tools.map((tool) => ({
      name: tool.name,
      ...(tool.modelName ? { modelName: tool.modelName } : {}),
      description: tool.description,
      // A copy through JSON: the converter's cache hands out one shared, mutable object.
      schema: JSON.parse(JSON.stringify(zodToJsonSchema(tool.inputSchema))) as Record<
        string,
        unknown
      >,
    })),
    cacheSessionId: input.cacheSessionId,
    toolNames: [...input.toolNames],
    profile: JSON.parse(JSON.stringify(input.profile)) as RunProfile,
    ...(input.retention ? { promptCacheRetention: input.retention } : {}),
  }
}

/** A fork cannot fork or delegate again; the tool stays listed so the tools block is unchanged. */
export const NESTED_FORK_REFUSAL =
  'A fork cannot fork or delegate again: do the work yourself with your own tools.'

/** A tool the fork was shown and cannot run. It refuses; it is never confirmed or run. */
function refusal(tool: ForkSeedTool): AgentTool {
  const text =
    tool.name === TOOL.delegate
      ? NESTED_FORK_REFUSAL
      : `\`${tool.name}\` is not available in this fork: use another tool.`
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    inputSchema: z.object({}).passthrough(),
    activeVerb: 'Running',
    classify: () => ({ effect: 'read' }),
    execute: async () => ({ content: text, isError: true }),
  } as AgentTool
}

/**
 * The tool as the parent declared it, running the child's own implementation: the name, the
 * description and the schema the model reads are the seed's; validation and execution are not.
 */
function declared(seed: ForkSeedTool, own: AgentTool | undefined): AgentTool {
  const base = own ?? refusal(seed)
  const { modelName: _own, ...rest } = base
  const validator = base.inputSchema
  const schema = {
    // The only two members the runtime reads of a schema (the same bridge an MCP tool uses).
    toJSONSchema: () => JSON.parse(JSON.stringify(seed.schema)) as Record<string, unknown>,
    safeParse: (value: unknown) => validator.safeParse(value),
  }
  return {
    ...rest,
    name: seed.name,
    description: seed.description,
    ...(seed.modelName ? { modelName: seed.modelName } : {}),
    inputSchema: schema as unknown as AgentTool['inputSchema'],
  }
}

/**
 * The surface a fork runs on: the tools it is shown (the parent's, in order) and the tools it can
 * dispatch (those, plus every tool of its own the parent was not shown, such as a deferred one).
 */
export function forkToolSurface(
  seed: ForkSeed,
  own: { tools: readonly AgentTool[]; dispatchTools: readonly AgentTool[] },
): { tools: AgentTool[]; dispatchTools: AgentTool[] } {
  const byName = new Map<string, AgentTool>()
  for (const tool of [...own.tools, ...own.dispatchTools])
    if (!byName.has(tool.name)) byName.set(tool.name, tool)
  const tools = seed.tools.map((tool) => declared(tool, byName.get(tool.name)))
  const shown = new Set(tools.map((tool) => tool.name))
  return {
    tools,
    dispatchTools: [...tools, ...own.dispatchTools.filter((tool) => !shown.has(tool.name))],
  }
}
