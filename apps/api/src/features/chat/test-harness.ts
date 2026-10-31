import type { AgentRuntime, LanguageModel, LanguageModelFactory } from '@localixai/agent/runtime'

import type { CatalogResponse } from '../catalog/contracts'
import { createCatalogService } from '../catalog/service'
import type { Kysely } from 'kysely'
import { capabilityStores } from '../../bootstrap/capability-stores'
import { createChatFeaturePorts } from '../../bootstrap/chat-feature-ports'
import type { AppDatabase } from '../../db/types'
import { userHome } from '../../lib/env'
import { capabilitiesChanged } from '../capabilities/revision'
import { createMiniAppService, type MiniAppService } from '../mini-apps/service'
import { createPluginService, type PluginService } from '../plugins/service'
import { createProjectsRepository } from '../projects/repository'
import { createChatRepository } from './repository'
import type { AgentTurnAdmission } from './runtime/agent-turn-ticket'
import { dispatchParams } from './runtime/run-params'
import { createChatService, type ChatService } from './service'
import type { ChatServiceDeps } from './service/context'

const EMPTY_CATALOG: CatalogResponse = {
  providers: [],
  models: [],
  oauthProviderIds: [],
  oauthProviders: [],
}

/** Minimal engine-neutral runtime ports for tests that never execute a model turn. */
export function createTestRuntimeDeps(): Pick<
  ChatServiceDeps,
  'agentRuntime' | 'languageModelFactory'
> {
  const agentRuntime: AgentRuntime = {
    adapter: { id: 'test', version: '1' },
    run(): never {
      throw new Error('Unexpected agent runtime call in a non-runtime test')
    },
    disposeSession(): void {},
  }
  const languageModelFactory: LanguageModelFactory = {
    create(ref): LanguageModel {
      return {
        ref,
        complete(): never {
          throw new Error('Unexpected language model call in a non-model test')
        },
      }
    },
  }
  return { agentRuntime, languageModelFactory }
}

export function createTestCatalogService(catalog: CatalogResponse = EMPTY_CATALOG) {
  return createCatalogService({ source: { list: () => catalog } })
}

type RuntimeDeps = 'agentRuntime' | 'languageModelFactory'
type TestRunner = NonNullable<ChatServiceDeps['runner']>

const servicesByDatabase = new WeakMap<object, Set<ChatService>>()
const wrappedDatabases = new WeakSet<object>()

/**
 * Construct the real chat service while supplying only inert test runtime ports.
 *
 * Tests historically destroyed their ephemeral database without first shutting
 * down the service. That races the real runner's asynchronous durable-queue
 * hydration and prints late "driver has already been destroyed" warnings in
 * unrelated test files. Keep the production lifecycle explicit, while making
 * the test fixture's database teardown own every service it created.
 */
export function createTestChatService(
  deps: Omit<ChatServiceDeps, RuntimeDeps | 'ports'> & Partial<Pick<ChatServiceDeps, 'ports'>>,
) {
  // Most service tests use small runner doubles because the model runtime is outside their scope.
  // Give those doubles the queue-facing operations introduced by the unified event loop while
  // preserving their existing `run` observation point.
  const partialRunner = deps.runner as
    | (TestRunner & {
        cancelAgentTurns?: TestRunner['cancelAgentTurns']
        enqueueRun?: TestRunner['enqueueRun']
      })
    | undefined
  // The default enqueue stands in for the queue AND its dispatcher: an admission carries no
  // history, so it reads the transcript the way `wake-queue/dispatch-agent.ts` does.
  const repo = createChatRepository(deps.db)
  const runner = partialRunner
    ? Object.assign(partialRunner, {
        cancelAgentTurns: partialRunner.cancelAgentTurns ?? (async () => {}),
        enqueueRun:
          partialRunner.enqueueRun ??
          (async (turn: AgentTurnAdmission) => {
            const history = await repo.listMessages(turn.userId, turn.session.id)
            return partialRunner.run(
              dispatchParams(
                {
                  userId: turn.userId,
                  session: turn.session,
                  assistantMessageId: turn.assistantMessageId,
                  historyMessages: history.filter((m) => m.id !== turn.assistantMessageId),
                },
                turn.scope,
                turn.completion,
              ),
            )
          }),
      })
    : undefined
  const service = createChatService({
    ...deps,
    ports: deps.ports ?? testChatFeaturePorts(deps.db),
    ...(runner ? { runner } : {}),
    ...createTestRuntimeDeps(),
  })
  let shutdownPromise: Promise<void> | undefined
  const shutdown = service.shutdown.bind(service)
  service.shutdown = () => (shutdownPromise ??= shutdown())

  // Focused tests may inject a deliberately partial AgentRunner double. It owns
  // no durable queue and therefore has no asynchronous DB work to drain (nor a
  // shutdown method to call).
  if (deps.runner && typeof deps.runner.shutdown !== 'function') return service

  const database = deps.db
  const services = servicesByDatabase.get(database) ?? new Set<ChatService>()
  services.add(service)
  servicesByDatabase.set(database, services)

  if (!wrappedDatabases.has(database)) {
    wrappedDatabases.add(database)
    const destroy = database.destroy.bind(database)
    database.destroy = async () => {
      await Promise.all([...services].map((ownedService) => ownedService.shutdown()))
      services.clear()
      await destroy()
    }
  }

  return service
}

/**
 * Chat's feature ports for a test with no host. The plugin and mini app services it does not
 * pass are built here, with the revision owner wired so a mutation still invalidates run-scope
 * caches.
 */
export function testChatFeaturePorts(
  db: Kysely<AppDatabase>,
  services: { pluginService?: PluginService; miniAppService?: MiniAppService } = {},
) {
  const projectsRepo = createProjectsRepository(db)
  const resolveProjectCwd = async (userId: string, projectId: string) =>
    (await projectsRepo.getProject(userId, projectId))?.workingDir ?? null
  return createChatFeaturePorts(db, {
    pluginService:
      services.pluginService ??
      createPluginService({
        db,
        capabilityStores,
        homeDir: userHome(),
        resolveProjectCwd,
        onChanged: () => {
          capabilitiesChanged()
        },
      }),
    miniAppService:
      services.miniAppService ??
      createMiniAppService({ db, capabilityStores, homeDir: userHome(), resolveProjectCwd }),
  })
}
