import { InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { pluginLoadBlockReason } from './load-block'
import { isAbsolute } from 'node:path'
import {
  type CapabilitySourceRecord,
  type CapabilitySourceRepository,
  scalarConfig,
} from '../capabilities/source-repository'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { localixWorkspaceDir } from '../../lib/env'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { isGitSource } from '../ext/git-source'
import {
  discoverPlugins,
  loadManifest,
  pluginInstallRoot,
  type DiscoveredPlugin,
} from './discovery'
import { cloneRepo, withPluginSource } from './install-helpers'
import { publishPluginInstallation } from './publish-installation'
import { buildPluginCatalog, type PluginCatalog } from './catalog'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { listCatalogCommandSpecs } from './plugin-skills'
import { listScopeOutputStyles } from './output-style-listing'
import {
  marketplacesRoot,
  parseMarketplaceRef,
  resolveBareInstall,
  resolveMarketplaceInstall,
  updateMarketplace,
  addMarketplace,
  type MarketplaceRegistryDeps,
  type ResolvedMarketplaceInstall,
} from './marketplace-registry'
import { createMarketplaceMethods } from './service-marketplaces'
import { normalizePluginDependencies } from './dependencies'
import { planDependencyEnables } from './dependencies-policy'
import { actionFor } from '../capabilities/resolve'
import type { RuleChange } from '../capabilities/rule-changes'
import {
  prepareDependenciesForInstall,
  type PreparedDependencyInstall,
} from './dependencies-install'
import { resolvePluginConfig } from './config'
import { isDefaultProject } from '../projects/default-project'
import { applyEntryManifestOverrides } from './marketplace-entry-manifest'
import { pluginTrustClass } from './enable'
import { validatePluginFull } from './validate'
import { listThemesFromCatalog } from './themes'
import type { PluginRecord } from './contracts'
import { toConfigFields, type PluginService, type PluginServiceDeps } from './service-types'
import { hydrateSecretOption } from './config-vault'
import { reconcileStoredConfig, savePluginConfig } from './service-config'
import {
  assertEnableChanges,
  reinstallFromSource,
  rowScopeOf,
  validatePluginDir,
} from './service-lifecycle'
import { removePlugin } from './service-remove'
import { inPlaceInstallFor, inPlacePublication } from './install-in-place'
import { assertNameNotBuiltin, assertNotBuiltin, BUILTIN_ORIGIN } from './builtin-plugins'
import { createPluginUpdates } from './plugin-updates'
import { ensureOfficialMarketplace } from './official-marketplace'
import { setInstallRecord } from './plugin-cache'
import { readRemoteCommit } from './git-fetch'
import {
  claimCachedRecord,
  existingVersion,
  releaseCachedCopiesOf,
  versionedInstallFor,
} from './install-versioned'

// Repo-clone + tree-copy install primitives live in ./install-helpers; re-exported
// here so existing importers of `./service` keep their import surface unchanged.
// Service interface + deps live in ./service-types; re-exported
// here so the historical `./service` import surface stays unchanged.
export type { PluginService, PluginServiceDeps } from './service-types'

export function createPluginService(deps: PluginServiceDeps): PluginService {
  // ONE home for every discovery and install root of this service (see `PluginServiceDeps.homeDir`).
  const home = deps.homeDir
  const discover = (scope: Omit<Parameters<typeof discoverPlugins>[0], 'homeDir'>) =>
    discoverPlugins({ ...scope, homeDir: home })
  const contributionKinds = deps.contributionKinds ?? createContributionKindRegistry()
  const now = deps.now ?? (() => new Date().toISOString())
  const repo: CapabilitySourceRepository = deps.capabilityStores.sources(deps.db, 'plugin', now)
  // Marketplace registry deps — one git clone primitive shared with plugin install.
  const registryDeps: MarketplaceRegistryDeps = { cloneRepo, now, root: marketplacesRoot(home) }
  // Tool rosters of enabled native plugins, remembered in memory and across restarts
  // (see `inspection-snapshots.ts`); every lifecycle mutation below invalidates them.

  // The Default project's dir is the PARENT of per-chat sandboxes, never a session cwd, so
  // it has no plugin root of its own: its chats see (and install into) the global root.
  const cwdFor = async (userId: string, projectId: string): Promise<string | null> => {
    if (!projectId || !deps.resolveProjectCwd) return null
    const dir = await deps.resolveProjectCwd(userId, projectId)
    return dir && !isDefaultProject({ workingDir: dir }) ? dir : null
  }

  /** Resolve the scope cwd then build the fused discovery+state catalog for it. */
  const catalogFor = async (userId: string, projectId: string) => {
    const [cwd, availability] = await Promise.all([
      projectId ? cwdFor(userId, projectId) : null,
      readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
    ])
    return buildPluginCatalog({ repo, availability, userId, projectId, cwd, homeDir: home })
  }

  /** Materialize one discovered plugin + its state into the UI record. */
  const toRecord = async (
    plugin: DiscoveredPlugin,
    state: CapabilitySourceRecord | undefined,
    enabled: boolean,
    /** Not running only because nobody has said yes yet — see `ext/trust.ts`. */
    awaitingConsent = false,
  ): Promise<PluginRecord> => {
    const resolvedConfig = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    let error = plugin.error
    const validationNotes = plugin.shadowNotes ?? []
    const loadBlocked = pluginLoadBlockReason(plugin)
    if (loadBlocked) error = error ? `${error}; ${loadBlocked}` : loadBlocked
    const validation = await validatePluginFull(plugin, { config: resolvedConfig })
    if (validationNotes.length) validation.warnings.push(...validationNotes)
    return {
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      homepage: plugin.manifest.homepage,
      migratedFrom: plugin.manifest.migratedFrom,
      ...(plugin.manifest.origin ? { importedFrom: plugin.manifest.origin.format } : {}),
      projectId: plugin.projectId,
      scope: plugin.scope,
      dir: plugin.dir,
      ...(plugin.inPlaceInstall ? { loadsInPlace: true } : {}),
      source: plugin.builtin ? BUILTIN_ORIGIN : (state?.source ?? 'local'),
      ...(plugin.builtin ? { builtin: true } : {}),
      enabled,
      ...(awaitingConsent ? { awaitingConsent } : {}),
      provides: plugin.provides,
      config: toConfigFields(plugin, state),
      error,
      validation,
    }
  }

  /** Find a single discovered plugin by (name, scope). */
  const findPlugin = async (
    userId: string,
    name: string,
    projectId: string,
  ): Promise<DiscoveredPlugin | null> => {
    const cwd = projectId ? await cwdFor(userId, projectId) : null
    const discovered = await discover({ cwd, projectId })
    return discovered.find((p) => p.manifest.name === name && p.projectId === projectId) ?? null
  }

  /**
   * The verdict for one plugin, by the same two-layer rule the catalog applies: a rule if
   * the scope has one, else the trust gate. Stated once so a single-record path (enable,
   * config, install) cannot answer differently from the list.
   */
  const verdictFor = async (
    userId: string,
    plugin: DiscoveredPlugin,
    agentId?: string | null,
  ): Promise<boolean> => {
    const availability = await readAvailability(deps.db, {
      userId,
      agentId: agentId || DEFAULT_AGENT_ID,
    })
    return (
      availability.effectFor('plugin', plugin.manifest.name, pluginTrustClass(plugin)) === 'allow'
    )
  }

  /** Resolve a discovered plugin or throw the canonical 404. */
  const requirePlugin = async (
    userId: string,
    name: string,
    projectId: string,
  ): Promise<DiscoveredPlugin> => {
    const plugin = await findPlugin(userId, name, projectId)
    if (!plugin) throw new NotFoundError('plugin_not_found', `Plugin "${name}" not found`)
    return plugin
  }

  /**
   * Materialize the UI records of one already-built catalog. Without a selected
   * project, only global plugins surface. `toRecord` validates skills per plugin, so map
   * it in parallel rather than awaiting each in turn.
   */
  const recordsFromCatalog = (catalog: PluginCatalog, projectId: string): Promise<PluginRecord[]> =>
    Promise.all(
      catalog.all.flatMap(({ plugin, state, enabled, awaitingConsent }) =>
        projectId || plugin.scope !== 'project'
          ? [toRecord(plugin, state, enabled, awaitingConsent)]
          : [],
      ),
    )

  /** One scope's plugin catalog, built where its project runs (the workspace when global). */
  const scopeCatalog = async (userId: string, scopeProjectId: string | null | undefined) => {
    const projectId = scopeProjectId ?? ''
    const runtimeCwd = (projectId ? await cwdFor(userId, projectId) : null) ?? localixWorkspaceDir()
    const catalog = await buildPluginCatalog({
      repo,
      availability: await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
      userId,
      projectId,
      cwd: projectId ? runtimeCwd : null,
      homeDir: home,
    })
    return { projectId, runtimeCwd, catalog }
  }

  /** `update`; a marketplace update has just refreshed the marketplace and says so. */
  const updatePlugin = async (
    userId: string,
    input: { name: string; projectId?: string | null },
    opts: { refreshMarketplace: boolean },
  ): Promise<PluginRecord> => {
    const plugin = await findPlugin(userId, input.name, input.projectId ?? '')
    assertNotBuiltin(plugin, 'update')
    return reinstallFromSource({
      repo,
      userId,
      name: input.name,
      projectId: input.projectId ?? '',
      plugin,
      registryDeps: opts.refreshMarketplace ? registryDeps : null,
      install: (source, projectId) =>
        service.install(userId, { source, projectId }, { replace: true }),
    })
  }

  const service: PluginService = {
    listOutputStyles: (userId, opts) =>
      listScopeOutputStyles({ catalogFor, cwdFor, homeDir: home }, userId, opts?.projectId ?? ''),
    async listPlugins(userId, opts) {
      const { projectId, catalog } = await scopeCatalog(userId, opts?.projectId)
      return { plugins: await recordsFromCatalog(catalog, projectId) }
    },

    /**
     * Everything the capability snapshot shows of plugins, from ONE catalog build: their records,
     * themes and commands. Asking through the single-purpose methods ran discovery, the DB state and
     * the enable rule once per projection, on every snapshot fetch.
     */
    async listPluginContributions(userId, opts) {
      const { projectId, runtimeCwd, catalog } = await scopeCatalog(userId, opts?.projectId)
      return {
        plugins: await recordsFromCatalog(catalog, projectId),
        themes: listThemesFromCatalog(catalog),
        commands: await listCatalogCommandSpecs(catalog, {
          projectId,
          projectDir: runtimeCwd,
          homeDir: home,
          modCommands: deps.modCommands?.() ?? [],
          logger: deps.logger,
        }),
      }
    },

    /**
     * Flatten the slash-commands declared by every ENABLED plugin in scope into
     * namespaced specs the composer can render. The `prompt` template stays
     * server-side (rendered during dispatch); only arg metadata is exposed.
     */
    async listPluginCommands(userId, opts) {
      const projectId = opts?.projectId ?? ''
      const catalog = await catalogFor(userId, projectId)
      return {
        commands: await listCatalogCommandSpecs(catalog, {
          projectId,
          projectDir: (projectId ? await cwdFor(userId, projectId) : null) ?? localixWorkspaceDir(),
          homeDir: home,
          modCommands: deps.modCommands?.() ?? [],
          logger: deps.logger,
        }),
      }
    },

    async planPolicyCascade(userId, scope, names) {
      const projectId = scope.projectId ?? ''
      const plans: RuleChange[] = []
      for (const name of names) {
        const plugin = await findPlugin(userId, name, projectId)
        // A rule may name a plugin this scope has never seen — an uninstall left its row, or
        // the change arrived for another machine's install. There is nothing to cascade.
        if (!plugin) continue
        if (normalizePluginDependencies(plugin.manifest.dependencies).length === 0) continue
        const discovered = await discover({
          cwd: projectId ? await cwdFor(userId, projectId) : null,
          projectId,
        })
        const plan = await planDependencyEnables(deps.db, {
          userId,
          plugin,
          discovered,
          agentId: scope.agentId,
        })
        plans.push(...plan.changes)
      }
      return plans
    },

    async onPolicyChanged() {
      deps.onChanged?.()
    },

    async setEnabled(userId, input, opts) {
      const projectId = input.projectId ?? ''
      const plugin = await requirePlugin(userId, input.name, projectId)
      assertEnableChanges({
        plugin,
        enabled: input.enabled,
        availability: await readAvailability(deps.db, {
          userId,
          agentId: input.agentId || DEFAULT_AGENT_ID,
        }),
        catalog:
          input.enabled || opts?.ignoreDependents ? null : await catalogFor(userId, projectId),
        refuseNoop: opts?.refuseNoop ?? false,
      })
      // Whose list the switch lands in. A plugin toggle is a rule like any other, so it
      // belongs to an agent; a caller that names none means the one that always exists.
      const targetAgentId = input.agentId || DEFAULT_AGENT_ID
      const own: RuleChange = {
        action: actionFor('plugin', input.name),
        resource: '*',
        effect: input.enabled ? 'allow' : 'deny',
      }
      // The cascade is PLANNED and then written with the change that caused it, so a plugin
      // is never allowed without the dependencies it needs — one transaction, not two.
      const cascade =
        input.enabled && normalizePluginDependencies(plugin.manifest.dependencies).length > 0
          ? await planDependencyEnables(deps.db, {
              userId,
              plugin,
              discovered: await discover({
                cwd: projectId ? await cwdFor(userId, projectId) : null,
                projectId,
              }),
              agentId: input.agentId,
            })
          : null
      await createAvailabilityWriter(deps.db).apply(userId, targetAgentId, [
        own,
        ...(cascade?.changes ?? []),
      ])
      const state = await hydrateSecretOption(
        userId,
        await repo.get(userId, rowScopeOf(plugin, projectId), input.name),
      )
      deps.onChanged?.()
      const record = await toRecord(plugin, state, await verdictFor(userId, plugin, input.agentId))
      if (cascade?.result.warnings.length) {
        record.validation.warnings.push(...cascade.result.warnings)
      }
      return record
    },

    async setConfig(userId, input) {
      const projectId = input.projectId ?? ''
      const plugin = await requirePlugin(userId, input.name, projectId)
      const { state } = await savePluginConfig({
        repo,
        userId,
        plugin,
        projectId,
        values: input.values,
      })
      deps.onChanged?.()
      return toRecord(plugin, state, await verdictFor(userId, plugin))
    },

    reconcileStoredConfig: (userId) =>
      reconcileStoredConfig({
        repo,
        userId,
        discover: async (projectId) =>
          discover({ cwd: projectId ? await cwdFor(userId, projectId) : null, projectId }),
        onRewritten: () => {
          deps.onChanged?.()
        },
        warn: (message) => deps.logger?.warn(message),
      }),

    async install(userId, input, opts) {
      const scope: 'global' | 'project' = input.projectId ? 'project' : 'global'
      const projectId = input.projectId ?? ''
      const cwd = projectId ? await cwdFor(userId, projectId) : null
      if (scope === 'project' && !cwd) {
        throw new InvalidRequestError(
          'plugin_no_project_dir',
          'This project has no folder of its own (chats without a project run in per-chat sandboxes). Install the plugin globally instead.',
        )
      }
      const installRoot = pluginInstallRoot(scope, cwd, home)
      await fs.mkdir(installRoot, { recursive: true })

      const source = input.source.trim()
      const replace = opts?.replace ?? false

      // `plugin@marketplace` → resolve the entry to a local dir via the registry,
      // then install it like any local source (one unified install path). A bare
      // plugin name (no `@marketplace`, not a path/git) searches registered
      // marketplaces, mirroring Claude Code's `plugin install <name>`.
      const marketRef = parseMarketplaceRef(source)
      let resolvedMarket: ResolvedMarketplaceInstall | null = null
      if (marketRef) {
        resolvedMarket = await resolveMarketplaceInstall(marketRef, registryDeps)
      } else if (!isGitSource(source) && !isAbsolute(source)) {
        resolvedMarket = await resolveBareInstall(source, registryDeps)
      }

      let depInstall: PreparedDependencyInstall | null = null
      // From a local-folder marketplace, a Claude Code plugin loads from that folder, never written.
      const inPlace = await inPlaceInstallFor(resolvedMarket, scope, installRoot)
      // A user-scope copy from a marketplace goes into the version cache (`install-versioned.ts`).
      const versioned = await versionedInstallFor({
        resolved: resolvedMarket,
        inPlace,
        scope,
        home,
      })
      if (versioned) {
        // Claude Code computes the version again and leaves the copy alone when it is the same.
        const current = await existingVersion(home, versioned, replace)
        const installed = current ? await findPlugin(userId, versioned.plugin, projectId) : null
        if (current && installed?.cachedInstall?.id === versioned.id) {
          // The fetch saw a newer commit that resolves to the same version: remember the commit,
          // so the next check does not offer this update again.
          if (versioned.commitSha && current.gitCommitSha !== versioned.commitSha)
            await setInstallRecord(home, versioned.id, {
              ...current,
              gitCommitSha: versioned.commitSha,
            })
          const state = await repo.get(userId, '', installed.manifest.name)
          const record = await toRecord(
            installed,
            await hydrateSecretOption(userId, state),
            await verdictFor(userId, installed),
          )
          return { ...record, upToDate: true }
        }
      }
      opts?.onPhase?.('installing')
      // Validate the actual copied tree before it becomes discoverable. Marketplace
      // overlays belong to preparation too: their failures must preserve the live tree.
      const prepare = async (directory: string) => {
        // What Localix does not run is said once, here.
        if (resolvedMarket && !inPlace)
          await applyEntryManifestOverrides(directory, resolvedMarket.entry)
        const candidate = inPlace
          ? await inPlace.load(projectId)
          : await loadManifest(directory, scope, projectId)
        if (candidate.error) throw new InvalidRequestError('plugin_invalid', candidate.error)
        await assertNameNotBuiltin(candidate.manifest.name)
        installNotes.push(
          ...(candidate.manifestIssues ?? []).map((found) => `${found.path}: ${found.message}`),
        )
      }
      if (resolvedMarket) {
        const discovered = await discover({ cwd, projectId })
        depInstall = await prepareDependenciesForInstall(resolvedMarket, registryDeps, discovered)
      }
      const enabledValue = input.enable
      const installNotes = [...(depInstall?.warnings ?? [])]
      const { plugin, state, warnings } = await withPluginSource(
        {
          source: resolvedMarket?.dir ?? source,
          installRoot,
          nameOverride: resolvedMarket?.entry.name,
          linkRoot: resolvedMarket?.linkRoot,
        },
        (parent) =>
          publishPluginInstallation({
            db: deps.db,
            stores: deps.capabilityStores,
            contributionKinds,
            userId,
            projectId,
            scope,
            installRoot,
            parent: inPlace ? { ...parent, inPlace: true } : parent,
            ...inPlacePublication(inPlace, scope, installRoot, projectId),
            ...(versioned
              ? {
                  versioned: {
                    root: versioned.root,
                    name: versioned.version,
                    claim: () => claimCachedRecord(home, versioned, now),
                  },
                }
              : {}),
            // A marketplace install records its canonical `<plugin>@<marketplace>` reference.
            source: resolvedMarket
              ? `${resolvedMarket.entry.name}@${resolvedMarket.marketplace}`
              : source,
            replace,
            enable: enabledValue,
            now,
            dependencies: depInstall,
            prepare,
            discover: () => discover({ cwd, projectId }),
          }),
      )
      // A user-scope install that is not a cached copy takes the name from one an earlier
      // install put in the version cache, which would otherwise keep loading first.
      if (scope === 'global' && !versioned) await releaseCachedCopiesOf(home, plugin.manifest.name)
      deps.onChanged?.()
      const record = await toRecord(
        plugin,
        await hydrateSecretOption(userId, state),
        await verdictFor(userId, plugin),
      )
      if (depInstall?.toInstall.length) record.installedDependencies = depInstall.toInstall
      installNotes.push(...warnings)
      if (installNotes.length) record.validation.warnings.push(...installNotes)
      return record
    },

    update: (userId, input) => updatePlugin(userId, input, { refreshMarketplace: true }),

    remove: (userId, input) =>
      removePlugin(
        {
          repo,
          home,
          cwdFor,
          discover,
          disable: (user, name, projectId) =>
            service.setEnabled(
              user,
              { name, projectId: projectId || null, enabled: false },
              { ignoreDependents: true },
            ),
          changed: () => deps.onChanged?.(),
          warn: (message) => deps.logger?.warn?.(message),
        },
        userId,
        input,
      ),

    validatePath: (dir, opts) => validatePluginDir(dir, opts),

    ensureOfficialMarketplace: () =>
      ensureOfficialMarketplace({
        root: registryDeps.root ?? marketplacesRoot(home),
        add: (source) => addMarketplace(source, registryDeps),
        env: deps.env ?? process.env,
      }),

    updates: createPluginUpdates({
      repo,
      home,
      find: (userId, name) => findPlugin(userId, name, ''),
      reinstall: (userId, source, onInstalling) =>
        service.install(
          userId,
          { source, projectId: null },
          { replace: true, onPhase: onInstalling },
        ),
      refreshMarketplace: (name) => updateMarketplace(name, registryDeps),
      remoteCommit: deps.remoteCommit ?? readRemoteCommit,
      env: deps.env ?? process.env,
      now,
    }),

    ...createMarketplaceMethods({
      registryDeps,
      repo,
      env: deps.env ?? process.env,
      update: (userId, name) => updatePlugin(userId, { name }, { refreshMarketplace: false }),
      remove: (userId, name) => service.remove(userId, { name }),
    }),

    // `/plugin reload` (CC's /reload-plugins) compat: fire the change notification so channels restart,
    // catalog caches clear, and the next run picks up fresh discovery results.
    onChanged: deps.onChanged
      ? () => {
          deps.onChanged!()
        }
      : undefined,
  }
  return service
}
