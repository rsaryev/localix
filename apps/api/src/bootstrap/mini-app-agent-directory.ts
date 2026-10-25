import type { MiniAppAgentDirectory } from '@localixai/mini-app-sdk/backend'

import { createMiniAppAgentDirectory } from '../features/mini-apps/agent-directory'
import type { MiniAppHostRefs } from './mini-app-host-refs'

/**
 * The boot-time half of `ctx.agents`, read through the late-bound host refs.
 *
 * Chat and the agent registry are created after the mini-app-host phase, so capturing either here
 * would bind a mini app backend to a service that does not exist yet. Reading per call is what lets
 * the wiring order stay honest. The per-run half is built in `chat/runtime/run/stages/context.ts`
 * from the run's own repository; both go through `createMiniAppAgentDirectory`, so a route and a
 * tool list the same agents.
 */
export function bootAgentDirectory(hostRefs: MiniAppHostRefs): MiniAppAgentDirectory {
  return createMiniAppAgentDirectory({
    sessionProject: async (...args) => {
      const seat = await hostRefs.chatService?.getSessionAgentRoute(...args)
      return seat ? (seat.projectId ?? null) : undefined
    },
    listAgents: async (userId, projectId) =>
      ((await hostRefs.listAgents?.(userId, { projectId })) ?? []).map((agent) => ({
        id: agent.record.id,
        handle: agent.record.handle,
        description: agent.record.description,
        enabled: agent.enabled,
      })),
  })
}
