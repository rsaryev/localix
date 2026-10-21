import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { capabilitiesChanged } from '../features/capabilities/revision'
import type { ChatFeaturePorts } from '../features/chat/feature-ports'
import { createContextStoreRepository } from '../features/context-store/repository'
import { createMcpRepository } from '../features/mcp/repository'
import { createMemoryRepository } from '../features/memory/repository'
import { createPluginService, type PluginService } from '../features/plugins/service'
import { createProjectsRepository } from '../features/projects/repository'
import { createUsageRepository } from '../features/usage/repository'
import { createUserProfileRepository } from '../features/user/repository'
import { userHome } from '../lib/env'

/**
 * Builds the stores chat depends on from other features (`ChatFeaturePorts`).
 *
 * `pluginService` is the HOST's when there is one. Building a second is a fallback for callers
 * with no host (tests): two services mean two inspection caches importing the same plugins, and
 * two `onChanged` owners where only the host's reconciles the live channel/backend/monitor hosts.
 * The fallback keeps the revision owner wired so a mutation still invalidates run-scope caches.
 */
export function createChatFeaturePorts(
  db: Kysely<AppDatabase>,
  options: { pluginService?: PluginService; now?: () => string } = {},
): ChatFeaturePorts {
  const projectsRepo = createProjectsRepository(db)
  const pluginService =
    options.pluginService ??
    createPluginService({
      db,
      homeDir: userHome(),
      now: options.now,
      resolveProjectCwd: async (...args) =>
        (await projectsRepo.getProject(...args))?.workingDir ?? null,
      onChanged: () => {
        capabilitiesChanged()
      },
    })
  return {
    usageRepo: createUsageRepository(db),
    memoryRepo: createMemoryRepository(db),
    userProfileRepo: createUserProfileRepository(db),
    projectsRepo,
    mcpRepo: createMcpRepository(db),
    pluginRepo: createCapabilitySourceRepository(db, 'plugin'),
    contextStore: createContextStoreRepository(db),
    pluginService,
  }
}
