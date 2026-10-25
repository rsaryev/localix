/**
 * The consumers on the core change feed besides the semantic index: the reactors (follow-ups
 * another feature performs when an owner announces a change, C5) and the projectors (the relay
 * to client topics, the usage ledger). Each is a named consumer with its own cursor and
 * reconcile; this file only gives them their ports.
 */
import type { Kysely } from 'kysely'
import type { ConsumerHandlers } from '@localixai/change-feed'
import type { AppDatabase } from '../db/types'
import type { CatalogService } from '../features/catalog/service'
import type { CoreCascades, CoreChangeFeed, CoreRefs } from '../features/changes/core-entities'
import { createAgentSeats } from '../features/chat/agent-seats/agent-seats'
import { createAgentSeatsRepository } from '../features/chat/agent-seats/seats-repository'
import type { AgentsService } from '../features/agents/service'
import { createCapabilityCleanup } from '../features/capabilities/cleanup'
import { mcpOAuthStore } from '../features/mcp/oauth/runtime'
import type { SecretsStore } from '../features/secrets/store-contracts'
import { forgetSecretOptions } from '../features/plugins/config-vault'
import { miniAppOptions } from '../features/mini-apps/config-vault'
import { createSessionResidue } from '../features/chat/session-residue'
import { createSubagentRowsChanges } from '../features/chat/service/subagent-rows-changes'
import { createStatusLineChanges } from '../features/chat/service/status-line-changes'
import type { StatusLine } from '../features/chat/service/status-line'
import type { SubagentRowsLive } from '../features/chat/service/subagent-rows-live'
import { cancelSessionLoops } from '../features/chat/service/loop-ops'
import { stopSessionMonitors } from '../features/chat/service/monitor-ops'
import type { NotificationJournal } from '../features/notifications/journal-contracts'
import { createUsageLedgerProjector } from '../features/usage/ledger-projector'
import { createUsageRepository } from '../features/usage/repository'
import { createRelay } from '../features/realtime/relay'
import { createRouteRepair } from '../features/chat/route-repair/route-repair'
import { createRouteSeatsRepository } from '../features/chat/route-repair/seats-repository'
import type { ProviderConditions } from '../features/notifications/conditions/providers'
import type { TriggerConditions } from '../features/notifications/conditions/triggers'
import type { createProjectsService } from '../features/projects/service'
import type { ProviderConnectionsService } from '../features/provider-connections/service'
import type { RealtimeResource } from '../features/realtime/resources'
import { createAgentTriggerCleanup } from '../features/triggers/agent-cleanup'
import type { TriggerEngine } from '../features/triggers/engine'
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
  agentsService: Pick<AgentsService, 'listAgents'>
  secretsStore: Pick<SecretsStore, 'unbindConsumer'>
  notifications: Pick<NotificationJournal, 'forgetSession' | 'repository'>
  sessionExists(userId: string, sessionId: string): Promise<boolean>
  providerConditions: Pick<ProviderConditions, 'connectionRemoved' | 'connectionsRemaining'>
  triggerConditions: Pick<TriggerConditions, 'routeStranded' | 'ownerGone'>
  /** The loops an agent armed stop with it. */
  triggerEngine: Pick<TriggerEngine, 'list' | 'end'>
  publish(userId: string, resources: RealtimeResource[]): void
  /** Re-converge the mini app backends and channels (each host debounces). */
  refreshMiniAppHosts(): void
  /** The subagent rows the chat service keeps: their inputs' notices redraw them. */
  subagentRows: SubagentRowsLive
  /** Claude Code's `statusLine` per conversation: its conversation's notices redraw it. */
  statusLine: StatusLine
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
      read: async (...args) =>
        (await deps.userService.getProfile(...args)).agentSettings?.modelRouting,
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
    publish: (...args) => deps.publish(...args),
  })
}

/** An agent is bound when it is a built-in or its file or plugin definition has a binding row. */
async function agentBound(db: Kysely<AppDatabase>, userId: string, agentId: string) {
  if (agentId.startsWith('builtin:')) return true
  return Boolean(
    await db
      .selectFrom('capability_source')
      .select('id')
      .where('user_id', '=', userId)
      .where('kind', '=', 'agent')
      .where('name', '=', agentId)
      .executeTakeFirst(),
  )
}

export function createAgentSeatsReactor(deps: CoreReactorDeps) {
  const userId = deps.defaultUserId
  return createAgentSeats({
    seats: createAgentSeatsRepository(deps.db),
    async handles(projectId) {
      const agents = await deps.agentsService.listAgents(userId, { projectId: projectId || null })
      return new Map(agents.map((agent) => [agent.record.id, agent.record.handle]))
    },
    bound: (agentId) => agentBound(deps.db, userId, agentId),
    async forgetModelSettings(agentId) {
      const settings = (await deps.userService.getProfile(userId)).agentSettings?.agentModelSettings
      if (!settings?.some((entry) => entry.agentId === agentId)) return
      await deps.userService.updateProfile(userId, {
        agentSettingsPatch: {
          agentModelSettings: settings.filter((entry) => entry.agentId !== agentId),
        },
      })
    },
    publish: (resources) => deps.publish(userId, resources),
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
    'mini-app': 'ignore',
    'mini-app.catalog': 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    project: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': (change) => {
      if (change.op === 'deleted') conditions.connectionRemoved(change.ref.userId, change.ref.id)
    },
  }
}

/**
 * What the mini app hosts (backends and channels) converge on: a mini app installed, updated or removed, a rule
 * that switches one on or off, or a project whose folder (so its project mini apps) moved.
 */
export function miniAppHostHandlers(refresh: () => void): ConsumerHandlers<CoreRefs, CoreCascades> {
  return {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': () => refresh(),
    'mini-app.catalog': 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    project: () => refresh(),
    'capability.rule': () => refresh(),
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }
}

export async function startCoreReactors(deps: CoreReactorDeps): Promise<void> {
  const repair = createRouteRepairReactor(deps)
  await deps.feed.subscribe('route-repair', repair.handlers, {
    kind: 'reactor',
    reconcile: () => repair.repairAll(),
  })
  const agentSeats = createAgentSeatsReactor(deps)
  await deps.feed.subscribe('agent-seats', agentSeats.handlers, {
    kind: 'reactor',
    reconcile: () => agentSeats.reconcile(),
  })
  const agentTriggers = createAgentTriggerCleanup({
    live: () => deps.triggerEngine.list({}),
    end: (...args) => deps.triggerEngine.end(...args),
    bound: (agentId) => agentBound(deps.db, deps.defaultUserId, agentId),
    ownerGone: (...args) => deps.triggerConditions.ownerGone(...args),
  })
  await deps.feed.subscribe('agent-triggers', agentTriggers.handlers, {
    kind: 'reactor',
    reconcile: () => agentTriggers.reconcile(),
  })
  const cleanup = createCapabilityCleanup({
    db: deps.db,
    userId: deps.defaultUserId,
    clearMcpSignIn: (...args) => mcpOAuthStore.clear(...args),
    unbindVaultConsumer: (...args) => deps.secretsStore.unbindConsumer(...args),
    forgetPluginSecrets: forgetSecretOptions,
    forgetMiniAppSecrets: miniAppOptions.forgetSecretOptions,
  })
  await deps.feed.subscribe('capability-cleanup', cleanup.handlers, { kind: 'reactor' })
  const residue = createSessionResidue({
    stopMonitors: stopSessionMonitors,
    cancelLoops: cancelSessionLoops,
    forgetNotifications: (...args) => deps.notifications.forgetSession(...args),
    projectDirs: async (...args) =>
      (await deps.projectsService.listProjects(...args)).projects.map((p) => p.workingDir),
    inboxSessions: () => deps.notifications.repository.sessionsWithRows(),
    sessionExists: (...args) => deps.sessionExists(...args),
  })
  await deps.feed.subscribe('session-residue', residue.handlers, {
    kind: 'reactor',
    reconcile: () => residue.reconcile(),
  })
  const subagentRows = createSubagentRowsChanges(deps.subagentRows)
  await deps.feed.subscribe('subagent-rows', subagentRows.handlers, {
    kind: 'projector',
    reconcile: subagentRows.reconcile,
  })
  const statusLine = createStatusLineChanges(deps.statusLine)
  await deps.feed.subscribe('status-line', statusLine.handlers, {
    kind: 'projector',
    reconcile: statusLine.reconcile,
  })
  const relay = createRelay({
    defaultUserId: deps.defaultUserId,
    publish: (...args) => deps.publish(...args),
  })
  await deps.feed.subscribe('relay', relay.handlers, { kind: 'projector' })
  const ledger = createUsageLedgerProjector({ usage: createUsageRepository(deps.db) })
  await deps.feed.subscribe('usage-ledger', ledger.handlers, {
    kind: 'projector',
    reconcile: ledger.reconcile,
  })
  await deps.feed.subscribe(
    'mini-app-hosts',
    miniAppHostHandlers((...args) => deps.refreshMiniAppHosts(...args)),
    {
      kind: 'reactor',
      reconcile: () => deps.refreshMiniAppHosts(),
    },
  )
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
