import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import { TOOL } from '../agent-core/tool-names'
import { FORK_AGENT, isForkName } from '../agent-core/tools/agent/agent-fork'
import { ENGINE_PROVIDER, fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'

/**
 * Subagents through the mods. `agent.offer` fires for each agent Localix lists to the model (the
 * agent directory) and again when the `Agent` tool names one: `{ isOffered: false }` keeps it
 * out of the listing and refuses its dispatch. `agent.spawn` fires when `Agent` is about to
 * start a child, everything decided and its model not yet resolved: a hook rewrites the task
 * (`prompt`), its title (`description`), the agent (`subagentType`) or `background`, picks the
 * child's `model`, or refuses with `{ deny }`, which the model reads as the tool's error. A task
 * the calling agent runs itself names `self` as its type, and a fork `fork: true`.
 */

export interface DirectoryAgent {
  agentId: string
  name: string
  description: string
  /** Where it is defined: Localix's registry, or a plugin's subagent type (`<plugin>:<name>`). */
  source?: 'localix' | 'plugin'
}

/** The agent `Agent` runs a task as when it names none. */
const SELF = 'self'

const string = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

async function offered(
  scope: ModEventScope,
  agent: string,
  description: string,
  source: DirectoryAgent['source'] = 'localix',
) {
  const input = { agent, description, source, provider: ENGINE_PROVIDER }
  const answer = await fireIn(scope, 'agent.offer', input, () => ({ isOffered: true }))
  return fieldOf(answer, 'isOffered') !== false
}

/** The directory's agents a mod lets the model see. */
export async function offerAgents<T extends DirectoryAgent>(
  scope: ModEventScope,
  agents: readonly T[],
): Promise<T[]> {
  if (!hearsIn(scope, 'agent.offer')) return [...agents]
  const kept = await Promise.all(
    agents.map((agent) => offered(scope, agent.name, agent.description, agent.source)),
  )
  return agents.filter((_, index) => kept[index])
}

const refused = (content: string): AgentToolResult => ({ content, isError: true })

/** `Agent` with `agent.offer` and `agent.spawn` before a child starts. */
export function wrapAgent(
  tools: readonly AgentTool[],
  scope: ModEventScope,
  run: { parentModel: string; directory: () => readonly DirectoryAgent[] },
): AgentTool[] {
  const offers = hearsIn(scope, 'agent.offer')
  if (!offers && !hearsIn(scope, 'agent.spawn')) return [...tools]
  return tools.map((tool) =>
    tool.name !== TOOL.Agent
      ? tool
      : {
          ...tool,
          async execute(toolCallId, input, signal, onUpdate, context) {
            const args = (input ?? {}) as Record<string, unknown>
            if (typeof args.prompt !== 'string')
              return tool.execute(toolCallId, input, signal, onUpdate, context)
            const fork = isForkName(args.subagent_type)
            const named = fork ? undefined : string(args.subagent_type)
            const listed = run.directory().find((agent) => agent.name === named)
            if (
              named &&
              offers &&
              !(await offered(scope, named, listed?.description ?? '', listed?.source))
            )
              return refused(`No enabled agent "${named}" here. Name one from the agent directory.`)
            let spawn: Record<string, unknown> = {
              tool_use_id: toolCallId,
              prompt: args.prompt,
              description: string(args.description) ?? '',
              subagentType: fork ? FORK_AGENT : (named ?? SELF),
              provider: ENGINE_PROVIDER,
              parentModel: run.parentModel,
              background: args.run_in_background !== false,
              fork,
            }
            const answer = await fireIn(scope, 'agent.spawn', spawn, (e) => {
              spawn = { ...spawn, ...(e as Record<string, unknown>) }
              return { model: string(spawn.model) ?? run.parentModel }
            })
            const deny = string(fieldOf(answer, 'deny'))
            if (deny) return refused(deny)
            const model = string(fieldOf(answer, 'model'))
            const type = string(spawn.subagentType)
            return tool.execute(
              toolCallId,
              {
                ...args,
                prompt: string(spawn.prompt) ?? args.prompt,
                description: string(spawn.description) ?? args.description,
                ...(type && type !== SELF ? { subagent_type: type } : { subagent_type: undefined }),
                run_in_background: spawn.background !== false,
                // A fork runs on its parent's model, whatever a hook picks.
                ...(model && model !== run.parentModel && !fork ? { model } : {}),
              },
              signal,
              onUpdate,
              context,
            )
          },
        },
  )
}
