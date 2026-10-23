import type { Kysely } from 'kysely'
import type { MiniAppUiActionContext } from '@localixai/mini-app-sdk/backend'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import type { AppDatabase } from '../../db'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { localixWorkspaceDir } from '../../lib/env'
import { NotFoundError } from '../../lib/domain-errors'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { actionFor } from '../capabilities/resolve'
import type { CapabilityStores } from '../capabilities/store-factory'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { recordCoreChanges } from '../changes/core-entities'
import {
  createContributionKindRegistry,
  type ContributionKindRegistry,
} from '../ext/contribution-kinds'
import { isDefaultProject } from '../projects/default-project'
import { buildMiniAppCatalog, type MiniAppCatalog } from './catalog'
import type { InvokeMiniAppUiActionRequest, MiniAppViewSpec } from './contracts-contributions'
import type { MiniAppCommandSpec, MiniAppRecord } from './contracts'
import { createMiniAppInspections } from './inspection-snapshots'
import { miniAppKitDir } from './authoring/kit-root'
import { createMiniAppAuthoring } from './authoring/service'
import { discoverMiniApps, miniAppInstallRoot } from './discovery'
import { miniAppTrustClass } from './catalog'
import { toMiniAppRecord } from './records'
import { syncBundledContributions } from './sync-bundled-contributions'
import { resolveMiniAppUiFile } from './ui-artifact'
import { createMiniAppWrites } from './service-writes'
import { withCatalogPreview } from './catalog-preview'
import { createMiniAppCatalogs } from './catalogs'
import { builtInMiniAppSources, createMiniAppStore, type MiniAppStoreSource } from './store'
import {
  invokeMiniAppUiAction,
  resolveMiniAppArgOptions,
  type MiniAppArgOptionsInput,
  type MiniAppServiceScope,
} from './service-ui'
import { listViewsFromCatalog, readViewHtml } from './views'

export interface MiniAppServiceDeps {
  db: Kysely<AppDatabase>
  /** Opens the capability source stores (supplied by the composition root). */
  capabilityStores: CapabilityStores
  contributionKinds?: ContributionKindRegistry
  homeDir: string
  now?: () => string
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  resolveSessionCwd?: (userId: string, sessionId: string) => Promise<string | null>
  /** A view's call into its own backend, through the backend host. */
  invokeUiAction?: (input: {
    app: string
    action: string
    payload: unknown
    context: MiniAppUiActionContext
  }) => Promise<unknown>
  logger?: { warn: (msg: string, meta?: unknown) => void }
  /** Where the mini app kit is; defaults to the one shipped beside the staged mini apps. */
  miniAppKitDir?: () => string
  /** The catalogs every installation reads; defaults to {@link builtInMiniAppSources}. */
  storeSources?: () => Promise<MiniAppStoreSource[]>
}

export type MiniAppService = ReturnType<typeof createMiniAppService>

/**
 * THE owner of mini apps: what is installed, whether each may run, its settings, its views and
 * commands. Every change is announced (`mini-app` and `capability.rule` notices); the hosts that
 * converge on it are consumers of those notices, never called from here.
 */
export function createMiniAppService(deps: MiniAppServiceDeps) {
  const now = deps.now ?? (() => new Date().toISOString())
  const repo: CapabilitySourceRepository = deps.capabilityStores.sources(deps.db, 'mini-app', now)
  const kinds = deps.contributionKinds ?? createContributionKindRegistry()
  const inspections = createMiniAppInspections({ homeDir: deps.homeDir, logger: deps.logger })
  const serializeContributions = createKeyedSerializer()

  // The Default project's folder is the parent of per-chat sandboxes: it has no mini apps root.
  const cwdFor = async (userId: string, projectId: string): Promise<string | null> => {
    if (!projectId || !deps.resolveProjectCwd) return null
    const dir = await deps.resolveProjectCwd(userId, projectId)
    return dir && !isDefaultProject({ workingDir: dir }) ? dir : null
  }

  const catalogFor = async (
    userId: string,
    projectId: string,
    agentId = DEFAULT_AGENT_ID,
  ): Promise<{ catalog: MiniAppCatalog; runtimeCwd: string }> => {
    const cwd = projectId ? await cwdFor(userId, projectId) : null
    const catalog = await buildMiniAppCatalog({
      repo,
      availability: await readAvailability(deps.db, { userId, agentId }),
      userId,
      projectId,
      cwd,
      homeDir: deps.homeDir,
    })
    return { catalog, runtimeCwd: cwd ?? localixWorkspaceDir() }
  }

  const records = async (userId: string, projectId: string): Promise<MiniAppRecord[]> => {
    const { catalog, runtimeCwd } = await catalogFor(userId, projectId)
    return Promise.all(
      catalog.all
        .filter(({ app }) => projectId || app.scope !== 'project')
        .map(({ app, state, enabled, awaitingConsent }) =>
          toMiniAppRecord({
            userId,
            app,
            state,
            enabled,
            awaitingConsent,
            runtimeCwd,
            inspections,
          }),
        ),
    )
  }

  const commandSpecs = (catalog: MiniAppCatalog): MiniAppCommandSpec[] =>
    catalog.enabled.flatMap(({ app }) =>
      app.commands.map((command) => ({
        app: app.name,
        name: command.name,
        fullName: `${app.name}:${command.name}`,
        description: command.description,
        args: command.args.map(({ optionsScript, ...arg }) =>
          optionsScript ? { ...arg, dynamic: true } : arg,
        ),
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        ...(command.featured ? { featured: true } : {}),
      })),
    )

  const scope: MiniAppServiceScope = { deps, catalogFor, cwdFor }

  const requireApp = async (userId: string, name: string, projectId: string) => {
    const { catalog } = await catalogFor(userId, projectId)
    const entry = catalog.all.find(({ app }) => app.name === name)
    if (!entry) throw new NotFoundError('mini_app_not_found', `Mini app "${name}" not found`)
    return entry
  }

  const setEnabled = async (
    userId: string,
    input: { name: string; projectId?: string | null; enabled: boolean; agentId?: string },
  ) => {
    await requireApp(userId, input.name, input.projectId ?? '')
    await createAvailabilityWriter(deps.db).apply(userId, input.agentId || DEFAULT_AGENT_ID, [
      {
        action: actionFor('mini-app', input.name),
        resource: '*',
        effect: input.enabled ? 'allow' : 'deny',
      },
    ])
    inspections.invalidate(input.name)
  }

  const writes = createMiniAppWrites({ deps, repo, inspections, requireApp, catalogFor })

  /** Creating, building and reloading the person's own mini apps (`authoring/`). */
  const authoring = createMiniAppAuthoring({
    discover: () => discoverMiniApps({ homeDir: deps.homeDir }),
    miniAppsRoot: miniAppInstallRoot('global', null, deps.homeDir),
    kitDir: deps.miniAppKitDir ?? miniAppKitDir,
    allowed: async (userId, app) =>
      (await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID })).effectFor(
        'mini-app',
        app.name,
        miniAppTrustClass(app),
      ) === 'allow',
    enable: (userId, name) => setEnabled(userId, { name, enabled: true }),
    disable: (userId, name) => setEnabled(userId, { name, enabled: false }),
    // A build replaced its code: every host converges on the notice, every surface re-reads.
    changed: () => void recordCoreChanges(deps.db, { entity: 'mini-app', op: 'resync' }),
  })

  const resync = async () => {
    inspections.invalidate()
    await recordCoreChanges(deps.db, { entity: 'mini-app', op: 'resync' })
  }

  // The store: what catalogs offer and the installs in flight; a finished install is announced.
  // The catalogs the store reads: the built-in ones, then those the person added.
  const catalogList = createMiniAppCatalogs({
    db: deps.db,
    builtIn: deps.storeSources ?? builtInMiniAppSources,
  })
  const store = createMiniAppStore({
    homeDir: deps.homeDir,
    sources: catalogList.sources,
    onInstalled: async (name, { fresh, userId }) => {
      // Choosing it in the store is the person's yes to run it; an update keeps their decision.
      if (fresh && userId) await setEnabled(userId, { name, enabled: true })
      await recordCoreChanges(deps.db, {
        entity: 'mini-app',
        op: 'upserted',
        ref: { id: name, scope: 'global' },
      })
    },
  })
  const catalogs = withCatalogPreview(catalogList, store)

  return {
    authoring,
    catalogs,
    store,
    /**
     * `/mini-app reload`: rebuild the person's own mini apps, then say every one changed, since a
     * folder edited on disk is a change no write announced.
     */
    async reload(userId: string) {
      const rebuilt = await authoring.rebuildAll(userId)
      await resync()
      return rebuilt
    },
    /** Folders changed under the host (a re-staged bundle): re-read every one. */
    resync,
    list: async (userId: string, opts?: { projectId?: string | null }) => ({
      miniApps: await records(userId, opts?.projectId ?? ''),
    }),

    /** Everything the capability snapshot shows of mini apps, from one catalog build. */
    async contributions(userId: string, opts?: { projectId?: string | null }) {
      const projectId = opts?.projectId ?? ''
      const { catalog } = await catalogFor(userId, projectId)
      return {
        miniApps: await records(userId, projectId),
        views: listViewsFromCatalog(catalog, projectId),
        commands: commandSpecs(catalog),
      }
    },

    /** A switch is a rule like any other: `mini-app:<name>`, in one agent's list. */
    setEnabled,

    ...writes,

    async listViews(userId: string, opts?: { projectId?: string | null }) {
      const projectId = opts?.projectId ?? ''
      const { catalog } = await catalogFor(userId, projectId)
      return { views: listViewsFromCatalog(catalog, projectId) as MiniAppViewSpec[] }
    },

    async getViewHtml(
      userId: string,
      input: { app: string; viewId: string; projectId?: string | null },
    ) {
      const { catalog } = await catalogFor(userId, input.projectId ?? '')
      return readViewHtml(catalog, input)
    },

    async resolveUiFile(userId: string, input: { app: string; file: string }) {
      const { catalog } = await catalogFor(userId, '')
      return resolveMiniAppUiFile(catalog, input.app, input.file)
    },

    invokeUiAction: (userId: string, input: InvokeMiniAppUiActionRequest) =>
      invokeMiniAppUiAction(scope, userId, input),

    async listCommands(userId: string, opts?: { projectId?: string | null }) {
      const { catalog } = await catalogFor(userId, opts?.projectId ?? '')
      return { commands: commandSpecs(catalog) }
    },

    /** The enabled mini app command a `/<app>:<name>` names, with its app's folder and settings. */
    async findCommand(userId: string, projectId: string, app: string, name: string) {
      const { catalog } = await catalogFor(userId, projectId)
      const entry = catalog.enabled.find(({ app: candidate }) => candidate.name === app)
      const command = entry?.app.commands.find((candidate) => candidate.name === name)
      return entry && command ? { app: entry.app, command } : null
    },

    resolveArgOptions: (userId: string, input: MiniAppArgOptionsInput) =>
      resolveMiniAppArgOptions(scope, userId, input),

    /** Publish the contributions (agents, …) of the mini apps Localix ships into one scope. */
    async syncBundledContributions(userId: string, projectId: string) {
      return serializeContributions(JSON.stringify([userId, projectId]), async () => {
        const cwd = await cwdFor(userId, projectId)
        if (projectId && !cwd) return
        const { catalog } = await catalogFor(userId, projectId)
        await syncBundledContributions({
          db: deps.db,
          stores: deps.capabilityStores,
          kinds,
          userId,
          projectId,
          apps: catalog.all.map(({ app }) => app),
          now,
        })
      })
    },
  }
}
