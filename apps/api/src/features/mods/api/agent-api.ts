import { TOOL } from '../../agent-core/tool-names'
import { modAgentDefinition } from '../agent-definition'
import type { ModAgentRun, ModScene, ModsPorts } from '../contracts'
import type { ModRegistry } from '../registry'
import type { RunSurface } from './run-api'

/**
 * `$.agent`: subagents as Localix runs them — a child session. `spawn` starts one the way the
 * turn's `Agent` tool does, so it needs the conversation's turn running, and resolves
 * to `{ agentId }` (the child's session) or `{ deny }`; `list` names the conversation's children;
 * `register` defines `<plugin>:<name>` as an agent definition, which the agent catalog lists beside
 * a plugin's agent files (`agent-definition.ts`), so a child spawned as it runs on its fields.
 * A spawn's `name` is what the child is addressed by (its task name); its `cwd` has no place in
 * `Agent`, which runs a child where the conversation is, or in a worktree of its own.
 */

const string = (value: unknown) => (typeof value === 'string' ? value : undefined)

export function createAgentApi(input: {
  plugin: string
  instance: string
  registry: ModRegistry
  scene: () => ModScene
  surface: () => RunSurface | undefined
  listRuns?: (scene: ModScene) => Promise<readonly ModAgentRun[]>
  report?: ModsPorts['report']
}) {
  return {
    async spawn(request: unknown) {
      const ask = (request ?? {}) as Record<string, unknown>
      const prompt = string(ask.prompt)
      if (!prompt) throw new Error('agent.spawn takes a prompt')
      const agent = input.surface()?.tools.find((tool) => tool.name === TOOL.Agent)
      if (!agent) return { deny: 'Subagents start from a running turn of a conversation' }
      const type = string(ask.subagentType)
      const defined = type ? input.registry.agent(type) : undefined
      const description = string(ask.description) ?? prompt.slice(0, 60)
      const first = defined?.definition.initialPrompt
      const result = await agent.execute(`mod-agent-${Date.now()}`, {
        // The agent's own first turn, with the spawn's prompt where it says `{{intent}}`.
        prompt: first?.includes('{{intent}}') ? first.replaceAll('{{intent}}', prompt) : prompt,
        description: (string(ask.name) ?? description).slice(0, 120),
        ...(type ? { subagent_type: type } : {}),
        // The child's model, which `Agent` takes from its host, never from the model.
        ...(string(ask.model) ? { model: string(ask.model) } : {}),
      })
      const started = (result.details as { tasks?: { sessionId?: string }[] } | undefined)
        ?.tasks?.[0]
      if (result.isError || !started?.sessionId) return { deny: result.content }
      return { agentId: started.sessionId, model: string(ask.model) ?? '' }
    },
    async list() {
      const runs = (await input.listRuns?.(input.scene())) ?? []
      return runs.map((run) => ({
        id: run.sessionId,
        name: run.taskName,
        description: run.taskName,
        type: run.agentId ?? 'self',
        // Claude Code's word for an agent that was stopped.
        status: run.status === 'stopped' ? 'killed' : run.status,
        ...(run.parentSessionId ? { parentId: run.parentSessionId } : {}),
      }))
    },
    async register(spec: unknown) {
      const fields = (spec ?? {}) as Record<string, unknown>
      const name = string(fields.name)
      const description = string(fields.description)
      if (!name || !description) throw new Error('agent.register takes a name and a description')
      const { agent, notApplied } = modAgentDefinition(input.plugin, spec)
      if (notApplied.length > 0)
        input.report?.(
          input.plugin,
          `agent.register: ${notApplied.join(', ')} of ${agent.fullName} are kept and not applied: Claude Code leaves them out of a plugin's agent`,
        )
      return {
        agent: input.registry.addAgent(input.instance, {
          name,
          description,
          prompt: agent.prompt,
          definition: agent,
        }),
      }
    },
  }
}
