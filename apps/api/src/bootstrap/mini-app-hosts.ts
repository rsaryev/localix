import { createMiniAppBackendHost } from '../features/mini-apps/backend-host'
import { loadMiniAppBackends } from '../features/mini-apps/loader'
import { createMiniAppWakes } from '../features/mini-apps/mini-app-wake'
import { resolveMiniAppRouteScope } from '../features/mini-apps/route-scope'
import { loadScopesWithinBudget, PLUGIN_SCOPE_BUDGET_MS } from '../features/plugins/scope-load'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../features/capabilities/availability'
import { createMiniAppHostServices } from './mini-app-host-services'
import type { SemanticService } from '../features/embeddings/service'
import type { DecisionService } from '../features/decisions/service'
import { createProjectsRepository } from '../features/projects/repository'
import type { createSecretsStore } from '../features/secrets/store'
import type { createSecretExposureShield } from '../features/secrets/exposure-shield'
import type { createMediaStore } from '../features/media/store'
import type { createLogger } from '../lib/logger'
import { MINI_APP_WARNINGS, warnOnce } from '../lib/warn-once'
import { localixWorkspaceDir, userHome, type loadEnv } from '../lib/env'
import type { createDatabase } from '../db'
import type { RegistriesPhase } from './registries'
import type { BootstrapServiceRefs } from './chat-service-deps'
import type { MiniAppHostRefs } from './mini-app-host-refs'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import {
  createMiniAppConditions,
  observeMiniAppConditions,
  type MiniAppConditions,
} from '../features/notifications/conditions/mini-apps'
import {
  createFirstReconcileSignal,
  type FirstReconcile,
} from '../features/mini-apps/mini-app-route-boot-hold'
import type { InfraPhase } from './infra'

export interface MiniAppHostsPhaseInput
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
    Pick<InfraPhase, 'notifications' | 'changes'> {
  db: ReturnType<typeof createDatabase>
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  serviceRefs: BootstrapServiceRefs
  secretsStore: ReturnType<typeof createSecretsStore>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  mediaStore: ReturnType<typeof createMediaStore>
  semanticService: SemanticService
  decisionService: DecisionService
}

export interface MiniAppHostsPhase {
  backendHost: ReturnType<typeof createMiniAppBackendHost>
  hostRefs: MiniAppHostRefs
  startBackendHost: () => void
  /** What is wrong with a mini app, as Event Center conditions — shared with the later hosts. */
  miniAppConditions: MiniAppConditions
  /** Marked when `startBackendHost`'s first reconcile ends; the route hold waits on it. */
  firstReconcile: FirstReconcile
}

export function createMiniAppHostsPhase({
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
  semanticService,
  decisionService,
  changes,
}: MiniAppHostsPhaseInput): MiniAppHostsPhase {
  const warnMiniAppOnce = warnOnce(logger, MINI_APP_WARNINGS)
  const miniAppConditions = createMiniAppConditions(notifications, env.LOCALIX_DEFAULT_USER_ID)
  // The per-run load and every mini app context are built inside the chat runtime, out of reach.
  observeMiniAppConditions(miniAppConditions)
  // LIVE mini-app-backend wiring: mini apps enabled in any exact session scope may
  // contribute process-global `BackendSubsystem`s (route mount + resource/search
  // providers + live WS frames + shutdown) — the bundled workbenches are examples.
  // The HOST owns the wiring as a reconciler (backend-host.ts): boot is the first
  // `reconcile()`, and a mini app toggle re-converges the same way via `refresh()`,
  // so enable/disable needs no restart. Failure-isolated per mini app inside
  // loadMiniAppBackends.
  // Late-bound settle hook: chatService (the stream registry the resources.changed
  // event rides) is created far below; the host reads this at settle time.
  const hostRefs: MiniAppHostRefs = {}
  // Safe to read `hostRefs.wakes` per wake: a mini app wakes long after chat bound it.
  const miniAppWakes = createMiniAppWakes({
    deliver: (...args) => hostRefs.wakes!.deliver(...args),
    logger,
  })
  const { hostForMiniApp, releaseMiniApp, settleMiniApp } = createMiniAppHostServices({
    hostRefs,
    serviceRefs,
    semanticService,
    decisionService,
    changes: changes.miniApps,
    secretsStore,
    secretExposureShield,
    mediaStore,
    miniAppWakes,
  })
  const backendScopeProjectsRepo = createProjectsRepository(db)
  const backendHost = createMiniAppBackendHost({
    /**
     * WHERE a mini app route call is happening, resolved per request (`route-scope.ts`): the
     * session id reaches `c.env` only once its ownership check passed. Read from the request rather
     * than captured, because a backend is wired once and the user switches session freely.
     *
     * Late-bound on purpose: `hostRefs.chatService` is assigned far below, long before any request
     * arrives, and reading it through the closure is the same trick the mini app service already
     * uses for `resolveSessionCwd`.
     */
    resolveScope: ({ userId, request }) =>
      resolveMiniAppRouteScope({
        userId,
        request,
        resolveSessionCwd: async (...args) =>
          (await hostRefs.chatService?.resolveSessionCwd(...args)) ?? null,
        resolveProjectCwd: (...args) => hostRefs.resolveProjectCwd!(...args),
        fallbackCwd: localixWorkspaceDir(),
      }),
    loadBackends: async () => {
      const userId = env.LOCALIX_DEFAULT_USER_ID
      const projects = await backendScopeProjectsRepo.listProjects(userId)
      const loadScope = async (projectId: string, cwd: string) =>
        loadMiniAppBackends({
          homeDir: userHome(),
          repo: createCapabilitySourceRepository(db, 'mini-app'),
          availability: await readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
          userId,
          projectId,
          cwd,
          logger: {
            warn: (msg, meta) => warnMiniAppOnce({ event: 'mini_app_backend.warn', msg, meta }),
            // The boot load is the one worth timing: `mini_apps.loaded` lands in the runtime
            // log so `scripts/startup-budget.ts` can report what a launch spent here.
            info: (msg, meta) => logger.info({ ...(meta as object), msg }),
          },
          hostForMiniApp,
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
          logger.warn({ event: 'mini_app_backend.scope_late', projectId, ms })
          backendHost.refresh()
        },
      })
      const scopedBackends: Awaited<ReturnType<typeof loadMiniAppBackends>>['backends'] = []
      const summaries: Awaited<ReturnType<typeof loadMiniAppBackends>>['loaded'] = []
      const seenScopeBackends = new Set<string>()
      for (const { backends: loaded, loaded: loadedSummaries } of results) {
        for (const backend of loaded) {
          // A global mini app is part of every project catalog. Keep its one
          // actual scope once; project-local overrides carry their own projectId.
          const key = `${backend.app}\x00${backend.projectId}\x00${backend.backend.id}`
          if (seenScopeBackends.has(key)) continue
          seenScopeBackends.add(key)
          scopedBackends.push(backend)
        }
        summaries.push(...loadedSummaries)
      }
      miniAppWakes.recordTools(summaries)
      // Only when EVERY scope answered may a mini app none of them enables lose its rows: a late
      // project's mini apps are simply not in this pass yet.
      if (late.length === 0) await miniAppConditions.enabled(new Set(summaries.map((s) => s.name)))
      return scopedBackends
    },
    conditions: miniAppConditions,
    releaseHostServices: releaseMiniApp,
    settleHostServices: settleMiniApp,
    subsystemRegistry,
    capabilityRegistry,
    wsFrameRegistry,
    resourceRefsRegistry,
    contextProviderRegistry,
    textInputSurfaceRegistry,
    onSettled: () => hostRefs.onCapabilitiesSettled?.(),
    logger: {
      info: (msg) => logger.info({ event: 'mini_app_backend.info', msg }),
      warn: (msg, meta) => warnMiniAppOnce({ event: 'mini_app_backend.warn', msg, meta }),
    },
  })
  const firstReconcile = createFirstReconcileSignal()
  const startBackendHost = (): void => {
    // Mini app backends are an optional, late-bound layer, kept OFF the core readiness path: an
    // unhealthy third-party register() must not stop /health, hydration or the UI. Consumers
    // resolve through registry getters and the dispatcher is live, so converging after core
    // composition is safe (it is also the hot-enable path); onSettled publishes
    // resources.changed. A mini app request that arrives first waits
    // (`mini-app-route-boot-hold.ts`).
    void backendHost
      .reconcile()
      .catch((error) => {
        logger.warn({
          event: 'mini_app_backend.boot_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(firstReconcile.mark)
  }

  return { backendHost, hostRefs, startBackendHost, miniAppConditions, firstReconcile }
}
