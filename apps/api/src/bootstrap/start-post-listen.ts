import type { createMiniAppChannelHost } from '../features/mini-apps/channel-host'
import type { createChatService } from '../features/chat/service'
import type { SemanticService } from '../features/embeddings/service'
import type { StoreService } from '../features/store/service'
import type { DomainServicesPhase } from './domain-services'
import type { EnginesPhase } from './engines'
import type { InfraPhase } from './infra'
import type { MiniAppHostsPhase } from './mini-app-hosts'
import { startAfterListen } from './post-listen'
import { invalidateStoreOn } from './store'
import { publishResourcesChanged } from '../features/realtime/resources'

export interface StartPostListenInput
  extends
    Pick<EnginesPhase, 'triggerConditions' | 'triggerEngine'>,
    Pick<DomainServicesPhase, 'projectsService' | 'userService' | 'agentsService'>,
    Pick<MiniAppHostsPhase, 'backendHost'> {
  infra: InfraPhase
  semanticService: SemanticService
  chatService: ReturnType<typeof createChatService>
  storeService: StoreService
  channelHost: ReturnType<typeof createMiniAppChannelHost>
  /** The hosts, engines and timers, in the order they start; `signal` is the shutdown. */
  start: (signal?: AbortSignal) => void
}

/** What runs once the server listens: the hosts and timers, semantic indexing, the core reactors. */
export function createStartPostListen(input: StartPostListenInput) {
  const { infra, chatService, storeService, backendHost, channelHost } = input
  const { env, logger, db, localModels } = infra
  const { semanticService } = input
  return (signal?: AbortSignal): Promise<void> =>
    startAfterListen(
      {
        logger,
        start: () => input.start(signal),
        semantic: { db, logger, localModels, semanticService, changes: infra.changes },
        statusPokes: {
          localModels,
          semanticService,
          store: storeService,
          chatService,
          env,
        },
        coreReactors: {
          db,
          feed: infra.changes.core,
          defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
          catalogService: infra.catalogService,
          providerConnectionsService: infra.providerConnectionsService,
          projectsService: input.projectsService,
          userService: input.userService,
          agentsService: input.agentsService,
          secretsStore: infra.secretsStore,
          notifications: infra.notifications,
          sessionExists: async (...args) =>
            Boolean(await infra.bootRepo.getSession(...args).catch(() => true)),
          providerConditions: infra.providerConditions,
          triggerConditions: input.triggerConditions,
          triggerEngine: input.triggerEngine,
          refreshMiniAppHosts: () => {
            backendHost.refresh()
            channelHost.refresh()
          },
          subagentRows: chatService.subagentRowsLive,
          statusLine: chatService.statusLine,
          publish: invalidateStoreOn(storeService, (userId, resources) =>
            publishResourcesChanged(chatService.streamRegistry, userId, resources),
          ),
        },
      },
      signal,
    )
}
