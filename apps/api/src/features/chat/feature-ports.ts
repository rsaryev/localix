import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { FileWatchDeps, createFileWatchService } from '../fs-watch/service'
import type { ContextStore } from '../context-store/repository'
import type { McpRepository } from '../mcp/repository'
import type { MemoryRepository } from '../memory/repository'
import type { PluginService } from '../plugins/service-types'
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
  memoryRepo: MemoryRepository
  userProfileRepo: UserProfileRepository
  projectsRepo: ReturnType<typeof createProjectsRepository>
  mcpRepo: McpRepository
  /** Plugin capability sources (`kind: 'plugin'`). */
  pluginRepo: CapabilitySourceRepository
  /** Externalized tool output (`context-store`). */
  contextStore: ContextStore
  /** The host's plugin service: one per process, so one inspection cache and `onChanged` owner. */
  pluginService: PluginService
  /** Builds the session file-tree watcher (`fs-watch`). */
  createFileWatcher: (deps: FileWatchDeps) => ReturnType<typeof createFileWatchService>
}
