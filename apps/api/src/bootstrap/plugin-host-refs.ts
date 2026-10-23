import type { WakeRequest } from '../features/chat/contracts'
import type { createAgentsService } from '../features/agents/service'
import type { createChatService } from '../features/chat/service'
import type { WakeDelivery } from '../features/triggers/delivery'
import type { PluginMonitorHost } from '../features/plugins/monitor-host'

/**
 * The LATE-BOUND references a plugin host reads through.
 *
 * Everything here is filled in after the plugin-host phase has already run — chat, projects and
 * the capability publisher are all created later, and some are replaced on a reload. A host that
 * captured a service at construction would keep calling a dead one; reading through this table is
 * what lets the wiring order stay honest instead of being worked around.
 *
 * Its own module because it is a CONTRACT between phases, while `plugin-hosts.ts` is composition:
 * every phase that fulfils a ref imports this, and none of them wants the host builder.
 */
export interface MiniAppHostRefs {
  onBackendHostSettled?: () => void
  chatServiceForCwd?: Pick<
    ReturnType<typeof createChatService>,
    'resolveSessionCwd' | 'sessionCoordination'
  >

  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Enumerates the user's projects for the `workspaces` host seam (project-rooted providers). */
  listProjects?: (
    userId: string,
  ) => Promise<readonly { id: string; name: string; workingDirectory: string | null }[]>
  chatService?: ReturnType<typeof createChatService>
  /** The agent registry's listing, for the plugin `agents` directory. */
  listAgents?: ReturnType<typeof createAgentsService>['listAgents']
  getHuman?: ReturnType<typeof createAgentsService>['getHuman']
  /** The one wake delivery (`features/triggers/delivery`), bound once chat exists. */
  wakes?: WakeDelivery<WakeRequest>
  publishCapabilityChange?: () => void
  channelHost?: { refresh: () => void }
  monitorHost?: Pick<PluginMonitorHost, 'refresh' | 'arm' | 'disarm'>
  /** The mods host: reloaded after a plugin change; its commands listed with the plugins'. */
  mods?: {
    refresh: () => void
    commands: () => ReadonlyArray<{
      plugin: string
      name: string
      description: string
      argumentHint?: string
    }>
    /** `session.receive`: a delivery's text as it is queued, or taken by a mod. */
    receive?: (delivery: {
      userId: string
      sessionId: string
      text: string
      source?: string
    }) => Promise<{ text: string } | { consumed: string }>
  }
}
