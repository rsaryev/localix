/**
 * ROUTE REPAIR — a reactor on the core change feed.
 *
 * A stored model route is the pair (provider, model); its connection id is only the account it
 * last ran on (P10). When that account is deleted, re-added under a new id or loses its key, every
 * place that stored the id keeps pointing at nothing: routes, the session choice maps, a project's
 * model and the per-workload routing. Run resolution already looks past a dead hint; this reactor
 * writes the live account back, so the UI shows and sends on what a run would use.
 *
 * It rebinds only what `routeReadiness` calls ready on another connection — never a guess across
 * providers, never a route whose stored account still works. Every rebind is guarded by the value
 * it read, so the reactor is idempotent: a duplicate notice, or its reconcile after a gap, finds
 * nothing left to change.
 */
import { routeReadiness, type RouteConnection } from '@localixai/agent/catalog'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ConsumerHandlers } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../../changes/core-entities'
import type { RealtimeResource } from '../../realtime/resources'
import type { RouteRepairRepository } from './routes-repository'

export interface StoredRouteHint {
  modelId?: string | null
  providerConnectionId?: string | null
}

export interface RouteRepairPorts {
  routes: RouteRepairRepository
  connections(userId: string): Promise<readonly RouteConnection[]>
  catalog(): Promise<readonly Pick<CatalogModel, 'id' | 'providerId'>[]>
  projects: {
    routes(userId: string): Promise<Array<StoredRouteHint & { id: string }>>
    rebind(userId: string, projectId: string, connectionId: string): Promise<void>
  }
  routing: {
    read(userId: string): Promise<Record<string, StoredRouteHint> | undefined>
    write(userId: string, routing: Record<string, StoredRouteHint>): Promise<void>
  }
  /** Every user whose routes a full reconcile visits. */
  users(): Promise<string[]>
  /**
   * The chats left with a route no live account can serve after the repair: a scheduled loop in
   * one would fail on every fire, so it is surfaced instead of failing silently.
   */
  stranded?(userId: string, sessionIds: ReadonlySet<string>): Promise<void> | void
  publish(userId: string, resources: RealtimeResource[]): void
}

export function createRouteRepair(ports: RouteRepairPorts) {
  async function repairUser(userId: string): Promise<RealtimeResource[]> {
    const [connections, catalog] = await Promise.all([ports.connections(userId), ports.catalog()])
    const live = new Set(connections.filter((c) => c.usable !== false).map((c) => c.id))
    /** The live account to rebind to, or null when the route works or cannot be repaired. */
    const works = (route: StoredRouteHint) =>
      Boolean(route.providerConnectionId && live.has(route.providerConnectionId))
    /** What a route needs: nothing (it works), a live account to move to, or nothing can serve it. */
    const assess = (route: StoredRouteHint): { to: string | null; stranded: boolean } => {
      if (!route.modelId || works(route)) return { to: null, stranded: false }
      const readiness = routeReadiness({ ...route, modelId: route.modelId }, connections, catalog)
      if (readiness.status === 'ready')
        return {
          to: readiness.connectionId !== route.providerConnectionId ? readiness.connectionId : null,
          stranded: false,
        }
      // A model of a known provider with no account left. A model no provider lists (an external
      // agent's) never had a connection to lose.
      const known =
        readiness.status === 'ambiguous' ||
        Boolean(readiness.status === 'no-connection' && readiness.providerId)
      return { to: null, stranded: known }
    }
    const rebindTo = (route: StoredRouteHint) => assess(route).to

    const changed = new Set<RealtimeResource>()
    const stranded = new Set<string>()
    for (const route of await ports.routes.routes(userId)) {
      const need = assess(route)
      if (need.to && (await ports.routes.rebindRoute(route, need.to))) changed.add('sessions')
      else if (need.stranded) stranded.add(route.sessionId)
    }
    await ports.stranded?.(userId, stranded)
    for (const project of await ports.projects.routes(userId)) {
      if (!project.providerConnectionId) continue
      const to = rebindTo(project)
      if (!to) continue
      await ports.projects.rebind(userId, project.id, to)
      changed.add('projects')
    }
    const routing = await ports.routing.read(userId)
    if (routing) {
      let moved = false
      const next = Object.fromEntries(
        Object.entries(routing).map(([task, route]) => {
          const to = route.providerConnectionId ? rebindTo(route) : null
          if (!to) return [task, route]
          moved = true
          return [task, { ...route, providerConnectionId: to }]
        }),
      )
      if (moved) {
        await ports.routing.write(userId, next)
        changed.add('profile')
      }
    }
    const resources = [...changed]
    if (resources.length > 0) ports.publish(userId, resources)
    return resources
  }

  async function repairAll(): Promise<void> {
    for (const userId of new Set(await ports.users())) await repairUser(userId)
  }

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
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
    // A model installed or removed here changes what the `local` provider can serve.
    'local.model': () => repairAll(),
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': async (change) => {
      if (change.op === 'resync') await repairAll()
      else await repairUser(change.ref.userId)
    },
  }

  return { repairUser, repairAll, handlers }
}
