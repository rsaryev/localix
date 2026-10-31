import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createAvailabilityWriter } from '../features/capabilities/availability'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import type { ChatFeaturePorts } from '../features/chat/feature-ports'
import { createContextStoreRepository } from '../features/context-store/repository'
import { createFileWatchService } from '../features/fs-watch/service'
import { createMcpRepository } from '../features/mcp/repository'
import type { PluginService } from '../features/plugins/service'
import type { MiniAppService } from '../features/mini-apps/service'
import { createProjectsRepository } from '../features/projects/repository'
import { createUsageRepository } from '../features/usage/repository'
import { createUserProfileRepository } from '../features/user/repository'

/**
 * Builds the stores chat depends on from other features (`ChatFeaturePorts`).
 *
 * `pluginService` and `miniAppService` are the HOST's: a second pair would mean two inspection
 * caches importing the same plugins, and two `onChanged` owners where only the host's reconciles
 * the live channel/backend/monitor hosts. A test with no host builds its own through
 * `testChatFeaturePorts` (`features/chat/test-harness.ts`).
 */
export function createChatFeaturePorts(
  db: Kysely<AppDatabase>,
  services: { pluginService: PluginService; miniAppService: MiniAppService },
): ChatFeaturePorts {
  return {
    usageRepo: createUsageRepository(db),
    userProfileRepo: createUserProfileRepository(db),
    projectsRepo: createProjectsRepository(db),
    mcpRepo: createMcpRepository(db),
    availabilityWriter: createAvailabilityWriter(db),
    pluginRepo: createCapabilitySourceRepository(db, 'plugin'),
    miniAppRepo: createCapabilitySourceRepository(db, 'mini-app'),
    contextStore: createContextStoreRepository(db),
    pluginService: services.pluginService,
    miniAppService: services.miniAppService,
    createFileWatcher: createFileWatchService,
  }
}
