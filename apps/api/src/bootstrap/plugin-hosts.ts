import { createPluginBackendHost } from '../features/plugins/backend-host'
import { loadPluginBackends } from '../features/plugins/loader'
import { createPluginWakes } from '../features/plugins/plugin-wake'
import { resolvePluginRouteScope } from '../features/plugins/route-scope'
import { loadScopesWithinBudget, PLUGIN_SCOPE_BUDGET_MS } from '../features/plugins/scope-load'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../features/capabilities/availability'
import { createPluginHostServices } from './plugin-host-services'
import { createProjectsRepository } from '../features/projects/repository'
import type { createSecretsStore } from '../features/secrets/store'
import type { createSecretExposureShield } from '../features/secrets/exposure-shield'
import type { createMediaStore } from '../features/media/store'
import type { createLogger } from '../lib/logger'
import { PLUGIN_WARNINGS, warnOnce } from '../lib/warn-once'
import { localixWorkspaceDir, userHome, type loadEnv } from '../lib/env'
import type { createDatabase } from '../db'
import type { RegistriesPhase } from './registries'
import type { BootstrapServiceRefs } from './chat-service-deps'
import type { PluginHostRefs } from './plugin-host-refs'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import {
  createPluginConditions,
  observePluginConditions,
  type PluginConditions,
} from '../features/notifications/conditions/plugins'
import {
  createFirstReconcileSignal,
  type FirstReconcile,
} from '../features/plugins/plugin-route-boot-hold'
import type { InfraPhase } from './infra'

export interface PluginHostsPhaseInput
  extends
    Pick<
      RegistriesPhase,
      | 'subsystemRegistry'
      | 'capabilityRegistry'
      | 'wsFrameRegistry'
      | 'resourceRefsRegistry'
      | 'contextProviderRegistry'
      | 'textInputSurfaceRegistry'
    >,
    Pick<InfraPhase, 'notifications'> {
  db: ReturnType<typeof createDatabase>
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  serviceRefs: BootstrapServiceRefs
  secretsStore: ReturnType<typeof createSecretsStore>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  mediaStore: ReturnType<typeof createMediaStore>
}

export interface PluginHostsPhase {
  backendHost: ReturnType<typeof createPluginBackendHost>
  hostRefs: PluginHostRefs
  startBackendHost: () => void
  /** What is wrong with a plugin, as Event Center conditions — shared with the later hosts. */
  pluginConditions: PluginConditions
  /** Marked when `startBackendHost`'s first reconcile ends; the route hold waits on it. */
  firstReconcile: FirstReconcile
}

export function createPluginHostsPhase({
  db,
  env,
  logger,
  serviceRefs,
  secretsStore,
  secretExposureShield,
  mediaStore,
  subsystemRegistry,
  capabilityRegistry,
  wsFrameRegistry,
  resourceRefsRegistry,
  contextProviderRegistry,
  textInputSurfaceRegistry,
  notifications,
}: PluginHostsPhaseInput): PluginHostsPhase {
  const warnPluginOnce = warnOnce(logger, PLUGIN_WARNINGS)
  const pluginConditions = createPluginConditions(notifications, env.LOCALIX_DEFAULT_USER_ID)
  // The per-run load and every plugin context are built inside the chat runtime, out of reach.
  observePluginConditions(pluginConditions)
  // LIVE plugin-backend wiring: plugins enabled in any exact session scope may
  // contribute process-global `BackendSubsystem`s (route mount + resource/search
  // providers + live WS frames + shutdown) — the bundled workbenches are examples.
  // The HOST owns the wiring as a reconciler (backend-host.ts): boot is the first
  // `reconcile()`, and a plugin toggle re-converges the same way via `refresh()`,
  // so enable/disable needs no restart. Failure-isolated per plugin inside
  // loadPluginBackends.
  // Late-bound settle hook: chatService (the stream registry the plugins.changed
  // event rides) is created far below; the host reads this at settle time.
  const hostRefs: PluginHostRefs = {}
  // Safe to read `hostRefs.wakes` per wake: a plugin wakes long after chat bound it.
  const pluginWakes = createPluginWakes({
    deliver: (...args) => hostRefs.wakes!.deliver(...args),
    logger,
  })
  const hostForPlugin = createPluginHostServices({
    hostRefs,
    serviceRefs,
    secretsStore,
    secretExposureShield,
    mediaStore,
    pluginWakes,
  })
  const backendScopeProjectsRepo = createProjectsRepository(db)
  const backendHost = createPluginBackendHost({
    /**
     * WHERE a plugin route call is happening, resolved per request (`route-scope.ts`): the session
     * id reaches `c.env` only once its ownership check passed. Read from the request rather than
     * captured, because a backend is wired once and the user switches session freely.
     *
     * Late-bound on purpose: `chatServiceForCwd` is assigned far below, long before any request
     * arrives, and reading it through the closure is the same trick the plugin service already
     * uses for `resolveSessionCwd`.
     */
    resolveScope: ({ userId, request }) =>
      resolvePluginRouteScope({
        userId,
        request,
        resolveSessionCwd: async (...args) =>
          (await hostRefs.chatServiceForCwd?.resolveSessionCwd(...args)) ?? null,
        resolveProjectCwd: (...args) => hostRefs.resolveProjectCwd!(...args),
        fallbackCwd: localixWorkspaceDir(),
      }),
    loadBackends: async () => {
      const userId = env.LOCALIX_DEFAULT_USER_ID
      const projects = await backendScopeProjectsRepo.listProjects(userId)
      const loadScope = async (projectId: string, cwd: string) =>
        loadPluginBackends({
          homeDir: userHome(),
          repo: createCapabilitySourceRepository(db, 'plugin'),
          availability: await readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
          userId,
          projectId,
          cwd,
          logger: {
            warn: (msg, meta) => warnPluginOnce({ event: 'plugin_backend.warn', msg, meta }),
            // The boot load is the one worth timing: `plugins.loaded` lands in the runtime
            // log so `scripts/startup-budget.ts` can report what a launch spent here.
            info: (msg, meta) => logger.info({ ...(meta as object), msg }),
          },
          hostForPlugin,
        })
      // The global scope first (it runs the shared bundled sync), projects concurrently, and a
      // project stuck past the budget (a folder-access prompt) joins on a later reconcile.
      const { results, late } = await loadScopesWithinBudget({
        first: { key: '', load: () => loadScope('', localixWorkspaceDir()) },
        rest: projects.map((project) => ({
          key: project.id,
          load: () => loadScope(project.id, project.workingDir),
        })),
        budgetMs: PLUGIN_SCOPE_BUDGET_MS,
        onLate: (projectId, ms) => {
          logger.warn({ event: 'plugin_backend.scope_late', projectId, ms })
          backendHost.refresh()
        },
      })
      const scopedBackends: Awaited<ReturnType<typeof loadPluginBackends>>['backends'] = []
      const summaries: Awaited<ReturnType<typeof loadPluginBackends>>['loaded'] = []
      const seenScopeBackends = new Set<string>()
      for (const { backends: loaded, loaded: loadedSummaries } of results) {
        for (const backend of loaded) {
          // A global plugin is part of every project catalog. Keep its one
          // actual scope once; project-local overrides carry their own projectId.
          const key = `${backend.pluginName}\x00${backend.projectId}\x00${backend.backend.id}`
          if (seenScopeBackends.has(key)) continue
          seenScopeBackends.add(key)
          scopedBackends.push(backend)
        }
        summaries.push(...loadedSummaries)
      }
      pluginWakes.recordTools(summaries)
      // Only when EVERY scope answered may a plugin none of them enables lose its rows: a late
      // project's plugins are simply not in this pass yet.
      if (late.length === 0) await pluginConditions.enabled(new Set(summaries.map((s) => s.name)))
      return scopedBackends
    },
    conditions: pluginConditions,
    subsystemRegistry,
    capabilityRegistry,
    wsFrameRegistry,
    resourceRefsRegistry,
    contextProviderRegistry,
    textInputSurfaceRegistry,
    onSettled: () => hostRefs.onBackendHostSettled?.(),
    logger: {
      info: (msg) => logger.info({ event: 'plugin_backend.info', msg }),
      warn: (msg, meta) => warnPluginOnce({ event: 'plugin_backend.warn', msg, meta }),
    },
  })
  const firstReconcile = createFirstReconcileSignal()
  const startBackendHost = (): void => {
    // Plugin backends are an optional, late-bound layer, kept OFF the core readiness path: an
    // unhealthy third-party register() must not stop /health, hydration or the UI. Consumers
    // resolve through registry getters and the dispatcher is live, so converging after core
    // composition is safe (it is also the hot-enable path); onSettled publishes
    // plugins.changed. A plugin request that arrives first waits (`plugin-route-boot-hold.ts`).
    void backendHost
      .reconcile()
      .catch((error) => {
        logger.warn({
          event: 'plugin_backend.boot_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(firstReconcile.mark)
  }

  return { backendHost, hostRefs, startBackendHost, pluginConditions, firstReconcile }
}
