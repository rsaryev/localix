import type { AgentsToolPort, CatalogAgent } from '../../../agent-core/tools/agents'
import { isToolDirect } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { AgentSummary } from '../../../agents/contracts'
import type { RuntimeToolWiringContext, buildRunToolRegistry } from './runtime-tools'

export function catalogAgent(agent: AgentSummary): CatalogAgent {
  return {
    id: agent.record.id,
    handle: agent.record.handle,
    description: agent.record.description,
    enabled: agent.enabled,
    canJoinConversation: agent.enabled && agent.invocations.chat === 'allow',
    scope: agent.scope,
    leadershipPriority: agent.record.leadershipPriority,
  }
}

/** Root chat only. No model-controlled user, registry, actor, policy or operation identity. */
export function buildAgentsOptions(
  ctx: RuntimeToolWiringContext,
  params: Parameters<typeof buildRunToolRegistry>[1],
): AgentsToolPort | undefined {
  const { userId, session, agentId, agentProfile } = params
  const service = ctx.deps.agentManagement
  if (
    !service ||
    session.sessionKind !== 'chat' ||
    session.provenance.kind !== 'root' ||
    !isToolDirect(agentProfile, TOOL.agents)
  )
    return undefined
  const operationPrefix = params.currentMessageId?.() ?? crypto.randomUUID()
  return {
    list: async () =>
      (await service.listAgents(userId, { projectId: session.projectId })).map(catalogAgent),
    create: async (toolCallId, input) => {
      const result = await service.createAgentsFromAgent(userId, input, {
        agentId,
        projectId: session.projectId,
        sessionId: session.id,
        operationId: `${params.currentMessageId?.() ?? operationPrefix}:${toolCallId}`,
      })
      // Publication has succeeded; a client notification cannot undo the saved agent.
      try {
        ctx.deps.announceCapabilityChange?.()
      } catch {
        /* refresh on the next snapshot */
      }
      return { created: result.created.map(catalogAgent), errors: result.errors }
    },
  }
}
