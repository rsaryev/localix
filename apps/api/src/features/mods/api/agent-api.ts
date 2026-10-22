import type { ModAgentRun, ModScene } from '../contracts'
import type { ModRegistry } from '../registry'
import type { RunSurface } from './run-api'

/**
 * `$.agent`: subagents as Localix runs them — a delegated child session. `spawn` starts one the
 * way the turn's `delegate` tool does, so it needs the conversation's turn running, and resolves
 * to `{ agentId }` (the child's session) or `{ deny }`; `list` names the conversation's children;
 * `register` defines `<plugin>:<name>`, whose prompt leads the task of a child spawned as it.
 */

const string = (value: unknown) => (typeof value === 'string' ? value : undefined)

export function createAgentApi(input: {
  instance: string
  registry: ModRegistry
  scene: () => ModScene
  surface: () => RunSurface | undefined
  listRuns?: (scene: ModScene) => Promise<readonly ModAgentRun[]>
}) {
  return {
    async spawn(request: unknown) {
      const ask = (request ?? {}) as Record<string, unknown>
      const prompt = string(ask.prompt)
      if (!prompt) throw new Error('agent.spawn takes a prompt')
      const delegate = input.surface()?.tools.find((tool) => tool.name === 'delegate')
      if (!delegate) return { deny: 'Subagents start from a running turn of a conversation' }
      const type = string(ask.subagentType)
      const defined = type ? input.registry.agent(type) : undefined
      const description = string(ask.description) ?? prompt.slice(0, 60)
      const result = await delegate.execute(`mod-agent-${Date.now()}`, {
        task: defined ? `${defined.prompt}\n\n${prompt}` : prompt,
        title: description.slice(0, 120),
        ...(type && !defined ? { agent: type } : {}),
        // The child's model, which `delegate` takes from its host, never from the model.
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
        status: run.status,
        ...(run.parentSessionId ? { parentId: run.parentSessionId } : {}),
      }))
    },
    register(spec: unknown) {
      const fields = (spec ?? {}) as Record<string, unknown>
      const name = string(fields.name)
      const description = string(fields.description)
      if (!name || !description) throw new Error('agent.register takes a name and a description')
      return {
        agent: input.registry.addAgent(input.instance, {
          name,
          description,
          prompt: string(fields.prompt) ?? '',
        }),
      }
    },
  }
}
