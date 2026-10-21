/**
 * The reactors on the core change feed: follow-ups another feature performs when an owner
 * announces a change (C5). Each is a named consumer with its own cursor and reconcile; this file
 * only gives them their ports.
 */
import type { Kysely } from 'kysely'
import type { ConsumerHandlers } from '@localixai/change-feed'
import type { AppDatabase } from '../db/types'
import type { CatalogService } from '../features/catalog/service'
import type { CoreCascades, CoreChangeFeed, CoreRefs } from '../features/changes/core-entities'
import { createRouteRepair } from '../features/chat/route-repair/route-repair'
import { createRouteSeatsRepository } from '../features/chat/route-repair/seats-repository'
import type { ProviderConditions } from '../features/notifications/conditions/providers'
import type { TriggerConditions } from '../features/notifications/conditions/triggers'
import type { createProjectsService } from '../features/projects/service'
import type { ProviderConnectionsService } from '../features/provider-connections/service'
import type { RealtimeResource } from '../features/realtime/resources'
import { createTriggerRepository } from '../features/triggers/repository'
import type { UserService } from '../features/user/service'

export interface CoreReactorDeps {
  db: Kysely<AppDatabase>
  feed: CoreChangeFeed
  defaultUserId: string
  catalogService: Pick<CatalogService, 'getCatalog'>
  providerConnectionsService: Pick<ProviderConnectionsService, 'listConnections'>
  projectsService: Pick<ReturnType<typeof createProjectsService>, 'listProjects' | 'updateProject'>
  userService: Pick<UserService, 'getProfile' | 'updateProfile'>
  providerConditions: Pick<ProviderConditions, 'connectionRemoved' | 'connectionsRemaining'>
  triggerConditions: Pick<TriggerConditions, 'routeStranded'>
  publish(userId: string, resources: RealtimeResource[]): void
}

export function createRouteRepairReactor(deps: CoreReactorDeps) {
  const seats = createRouteSeatsRepository(deps.db)
  const triggers = createTriggerRepository(deps.db)
  return createRouteRepair({
    seats,
    async connections(userId) {
      const { connections } = await deps.providerConnectionsService.listConnections(userId)
      return connections.map((c) => ({
        id: c.id,
        providerId: c.providerId,
        usable: c.keys.some((key) => key.enabled),
      }))
    },
    catalog: async () => (await deps.catalogService.getCatalog()).models,
    projects: {
      async routes(userId) {
        const { projects } = await deps.projectsService.listProjects(userId)
        return projects.map((p) => ({
          id: p.id,
          modelId: p.settings?.modelId,
          providerConnectionId: p.settings?.providerConnectionId,
        }))
      },
      async rebind(userId, projectId, providerConnectionId) {
        await deps.projectsService.updateProject(userId, projectId, {
          settingsPatch: { providerConnectionId },
        })
      },
    },
    routing: {
      read: async (userId) =>
        (await deps.userService.getProfile(userId)).agentSettings?.modelRouting,
      async write(userId, modelRouting) {
        await deps.userService.updateProfile(userId, {
          agentSettingsPatch: { modelRouting: modelRouting as never },
        })
      },
    },
    users: async () => [deps.defaultUserId, ...(await seats.owners())],
    async stranded(userId, sessionIds) {
      if (sessionIds.size === 0) return
      for (const trigger of await triggers.listLive())
        if (trigger.userId === userId && sessionIds.has(trigger.sessionId))
          deps.triggerConditions.routeStranded(trigger)
    },
    publish: deps.publish,
  })
}

/** Provider condition rows of a deleted connection: nothing is left to fix. */
export function notificationsCleanupHandlers(
  conditions: Pick<ProviderConditions, 'connectionRemoved'>,
): ConsumerHandlers<CoreRefs, CoreCascades> {
  return {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    'provider.connection': (change) => {
      if (change.op === 'deleted') conditions.connectionRemoved(change.ref.userId, change.ref.id)
    },
  }
}

export async function startCoreReactors(deps: CoreReactorDeps): Promise<void> {
  const repair = createRouteRepairReactor(deps)
  await deps.feed.subscribe('route-repair', repair.handlers, {
    kind: 'reactor',
    reconcile: () => repair.repairAll(),
  })
  await deps.feed.subscribe(
    'notifications-cleanup',
    notificationsCleanupHandlers(deps.providerConditions),
    {
      kind: 'reactor',
      async reconcile() {
        const { connections } = await deps.providerConnectionsService.listConnections(
          deps.defaultUserId,
        )
        const live = new Set(connections.map((c) => c.id))
        await deps.providerConditions.connectionsRemaining(deps.defaultUserId, live)
      },
    },
  )
}
