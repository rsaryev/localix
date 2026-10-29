import { join } from 'node:path'

import type { Kysely } from 'kysely'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import type { AppDatabase } from '../db'
import { createAvailabilityWriter, readAvailability } from '../features/capabilities/availability'
import { onCapabilityRevision } from '../features/capabilities/revision'
import type { AgentsService } from '../features/agents/service-contract'
import { createAgentNamesRepository } from '../features/chat/agent-names/names-repository'
import { agentStoreProviderOf } from '../features/agents/store-wiring'
import type { AgentModelChoicesPort } from '../features/agents/model-choices-port'
import type { McpService } from '../features/mcp/service'
import { mcpStoreProviderOf } from '../features/mcp/store-wiring'
import type { SkillFiles } from '../features/skills-curator/store-provider'
import type { SkillsCuratorService } from '../features/skills-curator/service'
import { skillStoreProviderOf } from '../features/skills-curator/store-wiring'
import { createMiniAppStoreProvider } from '../features/mini-apps/store-provider'
import type { createMiniAppService } from '../features/mini-apps/service'
import type { SemanticService } from '../features/embeddings/service'
import type { RealtimeResource } from '../features/realtime/resources'
import type { SearchService } from '../features/search/service'
import { createDismissalsRepository } from '../features/store/dismissals-repository'
import { createStoreIndexRepository } from '../features/store/index-repository'
import { createRecommendationEventsRepository } from '../features/store/recommendation-events-repository'
import { openStoreIndexDatabase } from '../features/store/index-repository-open'
import { createProjectSignals } from '../features/store/project-signals'
import { createStoreSemanticSource } from '../features/store/semantic'
import { STORE_COLLECTION } from '../features/store/search-provider'
import {
  createStoreService,
  type StoreContextPort,
  type StoreService,
} from '../features/store/service'
import { localixHome, userHome } from '../lib/env'
import type { PluginService } from '../features/plugins/service-types'
import { pluginStoreProviderOf } from '../features/plugins/store-wiring'

/** The Store index's file: derived, so it lives with the caches, not beside the database. */
export const storeIndexFile = (home = localixHome()) => join(home, 'cache', 'store-index.sqlite')

/**
 * The Store and its providers (`docs/internals/store.md`, "How it works"): each owner builds the
 * provider for its package kind, and the Store gets the list (A4). The Store imports no owner. It
 * asks the global search service, built later, through `connectSearch`; its own `store` provider
 * goes into that service's registry, and its listings into a semantic collection of their own.
 */
export function createStorePhase(deps: {
  miniAppService: ReturnType<typeof createMiniAppService>
  /** The MCP service and the database its rules live in: the MCP servers provider's. */
  mcpService: McpService
  db: Kysely<AppDatabase>
  /** The SKILL.md operations and the curator: the skills provider's. */
  skills: { files: SkillFiles; curator: SkillsCuratorService }
  /** The agents service: the agents provider's. */
  agentsService: AgentsService
  /** The person's model choices for agents (their settings): the agents provider's model field. */
  agentModelChoices?: AgentModelChoicesPort
  /** The plugin service: its marketplaces are the plugins provider's sources. */
  pluginService?: PluginService
  semanticService?: Pick<SemanticService, 'registerSource' | 'resync' | 'changed' | 'reader'>
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>
  /** What the working set says, for recommendations (`store-context.ts`). */
  workingContext?: StoreContextPort
  owner: string
  /** The index file; `:memory:` in a harness. */
  indexFile?: string
}): { storeService: StoreService; connectSearch(search: Pick<SearchService, 'search'>): void } {
  const { miniAppService } = deps
  const { db } = openStoreIndexDatabase(deps.indexFile ?? storeIndexFile())
  const index = createStoreIndexRepository(db)
  let search: Pick<SearchService, 'search'> | null = null
  const signals = createProjectSignals({ projectDir: deps.resolveProjectCwd })
  // The switches of skills and MCP servers are rules of the default agent, and every change to
  // agents, skills or servers made anywhere bumps the capability revision (A4: built here).
  const writer = createAvailabilityWriter(deps.db)
  const availabilityOf = (kind: 'mcp' | 'skill') => ({
    reader: (userId: string) => readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
    set: (userId: string, switches: Array<{ name: string; enabled: boolean }>) =>
      writer.set(userId, DEFAULT_AGENT_ID, kind, switches),
  })
  const onChange = (listener: () => void) => onCapabilityRevision(() => listener())
  const storeService = createStoreService({
    providers: [
      createMiniAppStoreProvider({
        store: miniAppService.store,
        catalogs: miniAppService.catalogs,
        apps: miniAppService,
        autoUpdate: miniAppService.autoUpdate,
      }),
      mcpStoreProviderOf({
        db: deps.db,
        service: deps.mcpService,
        resolveProjectCwd: deps.resolveProjectCwd,
        availability: availabilityOf('mcp'),
        onChange,
      }),
      skillStoreProviderOf({
        curator: deps.skills.curator,
        skills: deps.skills.files,
        availability: availabilityOf('skill'),
        onChange,
      }),
      agentStoreProviderOf(
        deps.agentsService,
        {
          chatsOf: async (agentId) =>
            new Set(
              (await createAgentNamesRepository(deps.db).sessionAgents(agentId)).map(
                (s) => s.sessionId,
              ),
            ).size,
        },
        onChange,
        deps.agentModelChoices,
      ),
      ...(deps.pluginService
        ? [
            pluginStoreProviderOf(deps.pluginService, {
              homeDir: userHome(),
              owner: deps.owner,
              cacheDir: join(localixHome(), 'cache', 'store-plugin-contents'),
            }),
          ]
        : []),
    ],
    index,
    search: async (...args) => {
      if (!search) throw new Error('The global search service is not built yet')
      return search.search(...args)
    },
    projectWords: (...args) => signals.of(...args),
    projectFacts: (...args) => signals.facts(...args),
    dismissals: createDismissalsRepository(deps.db),
    recommendationEvents: createRecommendationEventsRepository(deps.db),
    ...(deps.workingContext ? { workingContext: deps.workingContext } : {}),
    ...(deps.semanticService
      ? {
          resyncMeaning: () => void deps.semanticService!.resync(STORE_COLLECTION).catch(() => {}),
          meaningChanged: (keys: string[]) =>
            void deps.semanticService!.changed(STORE_COLLECTION, keys).catch(() => {}),
          similarToItems: (userId, members, options) =>
            deps.semanticService!.reader.similarToItems(userId, STORE_COLLECTION, members, options),
        }
      : {}),
  })
  deps.semanticService?.registerSource(createStoreSemanticSource({ index, owner: deps.owner }))
  return {
    storeService,
    connectSearch(service) {
      search = service
    },
  }
}

/**
 * A poke the relay sends for an owner's change notice: when it names the Store, the Store's index
 * is out of date too, so it is synced again (a removal in Settings, a catalog added).
 */
export function invalidateStoreOn(
  store: Pick<StoreService, 'invalidate'>,
  publish: (userId: string, resources: RealtimeResource[]) => void,
) {
  return (userId: string, resources: RealtimeResource[]) => {
    if (resources.includes('store')) store.invalidate()
    publish(userId, resources)
  }
}
