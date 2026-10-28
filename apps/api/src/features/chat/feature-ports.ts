import type { AvailabilityWriter } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { FileWatchDeps, createFileWatchService } from '../fs-watch/service'
import type { ContextStore } from '../context-store/repository'
import type { McpRepository } from '../mcp/repository'
import type { PluginService } from '../plugins/service-types'
import type { MiniAppService } from '../mini-apps/service'
import type { createProjectsRepository } from '../projects/repository'
import type { UsageRepository } from '../usage/repository'
import type { UserProfileRepository } from '../user/repository'

/**
 * The other features' stores and services chat reads and writes. Chat never builds them: the
 * composition root does (`bootstrap/chat-feature-ports.ts`) and hands one set to the service
 * graph, which passes the same instances on to the runner.
 */
export interface ChatFeaturePorts {
  usageRepo: UsageRepository
  userProfileRepo: UserProfileRepository
  projectsRepo: ReturnType<typeof createProjectsRepository>
  mcpRepo: McpRepository
  /** Where a capability's on/off switch is stored (`/mcp enable|disable`). */
  availabilityWriter: AvailabilityWriter
  /** Plugin capability sources (`kind: 'plugin'`). */
  pluginRepo: CapabilitySourceRepository
  /** Mini app capability sources (`kind: 'mini-app'`). */
  miniAppRepo: CapabilitySourceRepository
  /** Externalized tool output (`context-store`). */
  contextStore: ContextStore
  /** The host's plugin service: one per process, so one inspection cache and `onChanged` owner. */
  pluginService: PluginService
  /** The host's mini app service: what `/mini-app` reads and changes. */
  miniAppService: MiniAppService
  /** Builds the session file-tree watcher (`fs-watch`). */
  createFileWatcher: (deps: FileWatchDeps) => ReturnType<typeof createFileWatchService>
}
