import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  UnavailableError,
  UnprocessableError,
} from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { pluginLoadBlockReason } from './loadable'
import { isAbsolute } from 'node:path'
import {
  type CapabilitySourceRecord,
  type CapabilitySourceRepository,
  scalarConfig,
} from '../capabilities/source-repository'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { isGitSource } from '../ext/git-source'
import { configPatchValues } from '../ext/config-fields'
import { removeIfUnderRoot } from '../ext/install-tree'
import {
  discoverPlugins,
  loadManifest,
  pluginInstallRoot,
  type DiscoveredPlugin,
} from './discovery'
import { pluginKitDir } from './authoring/kit-root'
import { createPluginAuthoring } from './authoring/service'
import { cloneRepo, withPluginSource } from './install-helpers'
import { publishPluginInstallation } from './publish-installation'
import { syncBundledContributions } from './sync-bundled-contributions'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { buildPluginCatalog, type PluginCatalog } from './catalog'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { listCatalogCommandSpecs } from './plugin-skills'
import { listScopeOutputStyles } from './output-style-listing'
import {
  marketplacesRoot,
  parseMarketplaceRef,
  resolveBareInstall,
  resolveMarketplaceInstall,
  type MarketplaceRegistryDeps,
  type ResolvedMarketplaceInstall,
} from './marketplace-registry'
import { createMarketplaceMethods } from './service-marketplaces'
import { listDependents, normalizePluginDependencies } from './dependencies'
import { planDependencyEnables } from './dependencies-policy'
import { actionFor } from '../capabilities/resolve'
import type { RuleChange } from '../capabilities/rule-changes'
import {
  prepareDependenciesForInstall,
  type PreparedDependencyInstall,
} from './dependencies-install'
import { normalizePluginSurfaces } from './contracts-base'
import { resolvePluginConfig } from './config'
import { confineToDir } from '../ext/fs-discovery'
import { runArgOptionsScript, parseArgOptions } from './arg-options'
import { isDefaultProject } from '../projects/default-project'
import { applyEntryManifestOverrides } from './marketplace-entry-manifest'
import { createPluginInspections } from './inspection-snapshots'
import type { PluginToolInspection } from './inspection-store'
import { pluginTrustClass } from './enable'
import { validatePluginFull } from './validate'
import { listViewsFromCatalog, readViewHtml } from './views'
import { listThemesFromCatalog } from './themes'
import { readPluginUiDescriptor, resolvePluginUiFile } from './ui-artifact'
import type { PluginViewSpec, PluginRecord } from './contracts'
import { toConfigFields, type PluginService, type PluginServiceDeps } from './service-types'

// Repo-clone + tree-copy install primitives live in ./install-helpers; re-exported
// here so existing importers of `./service` keep their import surface unchanged.
export { copyPluginTree } from './install-helpers'
// Service interface + deps live in ./service-types; re-exported
// here so the historical `./service` import surface stays unchanged.
export type { PluginService, PluginServiceDeps } from './service-types'

const PLUGIN_UI_ACTION_JSON_CAP_BYTES = 256 * 1024

function jsonValueWithinCap(value: unknown, label: string): unknown {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value ?? null)
  } catch {
    throw new UnprocessableError(
      'plugin_ui_action_invalid_json',
      `${label} must be JSON-serializable`,
    )
  }
  if (encoded === undefined) {
    throw new UnprocessableError(
      'plugin_ui_action_invalid_json',
      `${label} must be JSON-serializable`,
    )
  }
  if (Buffer.byteLength(encoded) > PLUGIN_UI_ACTION_JSON_CAP_BYTES) {
    throw new UnprocessableError(
      'plugin_ui_action_too_large',
      `${label} exceeds ${PLUGIN_UI_ACTION_JSON_CAP_BYTES} bytes`,
    )
  }
  return JSON.parse(encoded) as unknown
}

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const serializeContributions = createKeyedSerializer()
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
  const inspections = createPluginInspections({ homeDir: home, logger: deps.logger })
  const invalidateInspection = (name?: string, projectId?: string) =>
    inspections.invalidate(name, projectId)

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
    userId: string,
    plugin: DiscoveredPlugin,
    state: CapabilitySourceRecord | undefined,
    enabled: boolean,
    runtimeCwd: string = localixWorkspaceDir(),
    /** Not running only because nobody has said yes yet — see `ext/trust.ts`. */
    awaitingConsent = false,
  ): Promise<PluginRecord> => {
    const resolvedConfig = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    let tools: PluginToolInspection['tools'] = []
    let backendSubsystems: string[] = []
    let error = plugin.error
    // Only import (run) a plugin's code when it's enabled — same trust gate the
    // runtime loader uses. Disabled plugins show declared capabilities only.
    // Run tool inspection and the canonical full validation in parallel (independent I/O).
    // `validatePluginFull` is the shared manifest+skills merge (also used by the dev CLI) —
    // no inline duplication of the merge here.
    // The third path that RUNS plugin code (it imports the tool module to list tool names), so it
    // asks the same question as the loader — otherwise Settings would execute a plugin the host has
    // refused to load.
    const loadBlocked = pluginLoadBlockReason(plugin)
    if (loadBlocked) error = error ? `${error}; ${loadBlocked}` : loadBlocked
    const [inspected, validation, ui] = await Promise.all([
      enabled && plugin.provides.hasNativeTools && !loadBlocked
        ? inspections.inspect(plugin, resolvedConfig, userId, runtimeCwd)
        : Promise.resolve(null),
      validatePluginFull(plugin, { config: resolvedConfig }),
      readPluginUiDescriptor(plugin),
    ])
    if (inspected) {
      tools = inspected.tools
      backendSubsystems = inspected.backendSubsystems
      if (inspected.error) error = error ? `${error}; ${inspected.error}` : inspected.error
    }
    return {
      name: plugin.manifest.name,
      category: plugin.manifest.category,
      displayName: plugin.manifest.displayName,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      homepage: plugin.manifest.homepage,
      migratedFrom: plugin.manifest.migratedFrom,
      ...(plugin.manifest.origin ? { importedFrom: plugin.manifest.origin.format } : {}),
      layout: plugin.layout,
      surfaces: normalizePluginSurfaces(plugin.manifest.surfaces),
      projectId: plugin.projectId,
      scope: plugin.scope,
      dir: plugin.dir,
      source: state?.source ?? 'local',
      enabled,
      ...(awaitingConsent ? { awaitingConsent } : {}),
      bundled: plugin.bundled,
      ...(ui ? { ui } : {}),
      provides: { ...plugin.provides, tools, backendSubsystems },
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
   * project, only global plugins surface. `toRecord` does independent per-plugin I/O
   * (tool inspection + skill validation), so map it in parallel rather than awaiting
   * each in turn.
   */
  const recordsFromCatalog = (
    userId: string,
    catalog: PluginCatalog,
    projectId: string,
    runtimeCwd: string,
  ): Promise<PluginRecord[]> =>
    Promise.all(
      catalog.all.flatMap(({ plugin, state, enabled, awaitingConsent }) =>
        projectId || plugin.scope !== 'project'
          ? [toRecord(userId, plugin, state, enabled, runtimeCwd, awaitingConsent)]
          : [],
      ),
    )

  const service: PluginService = {
    async syncBundledContributions(userId, projectId) {
      return serializeContributions(JSON.stringify([userId, projectId]), async () => {
        const cwd = await cwdFor(userId, projectId)
        if (projectId && !cwd) return
        await syncBundledContributions({
          db: deps.db,
          stores: deps.capabilityStores,
          kinds: contributionKinds,
          userId,
          projectId,
          plugins: await discover({ cwd, projectId }),
          now: deps.now ?? (() => new Date().toISOString()),
        })
      })
    },
    listOutputStyles: (userId, opts) =>
      listScopeOutputStyles({ catalogFor, cwdFor, homeDir: home }, userId, opts?.projectId ?? ''),
    async listPlugins(userId, opts) {
      const projectId = opts?.projectId ?? ''
      const runtimeCwd =
        (projectId ? await cwdFor(userId, projectId) : null) ?? localixWorkspaceDir()
      const catalog = await buildPluginCatalog({
        repo,
        availability: await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
        userId,
        projectId,
        cwd: projectId ? runtimeCwd : null,
        homeDir: home,
      })
      return { plugins: await recordsFromCatalog(userId, catalog, projectId, runtimeCwd) }
    },

    /**
     * Every plugin-derived contribution of one scope, from ONE catalog build.
     *
     * The capability snapshot needs plugins + views + commands together, and
     * asking for them through the single-purpose methods above ran discovery,
     * DB state load, and the enable rule four times over — per snapshot fetch, and a
     * snapshot fetch happens on every plugin toggle. Same helpers, same fusion path
     * (`buildPluginCatalog`), one pass.
     */
    async listPluginContributions(userId, opts) {
      const projectId = opts?.projectId ?? ''
      const runtimeCwd =
        (projectId ? await cwdFor(userId, projectId) : null) ?? localixWorkspaceDir()
      const catalog = await buildPluginCatalog({
        repo,
        availability: await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
        userId,
        projectId,
        cwd: projectId ? runtimeCwd : null,
        homeDir: home,
      })
      return {
        plugins: await recordsFromCatalog(userId, catalog, projectId, runtimeCwd),
        views: listViewsFromCatalog(catalog, projectId),
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
     * Flatten the UI views declared by every ENABLED plugin in scope. HTML is
     * NOT inlined here — the UI fetches it per view on open (getViewHtml).
     */
    async listPluginViews(
      userId: string,
      opts?: { projectId?: string | null },
    ): Promise<{ views: PluginViewSpec[] }> {
      const projectId = opts?.projectId ?? ''
      const catalog = await catalogFor(userId, projectId)
      return { views: listViewsFromCatalog(catalog, projectId) }
    },

    /** Read one ENABLED plugin's view HTML (path-confined + size-capped — see views.ts). */
    async getViewHtml(
      userId: string,
      input: { pluginName: string; viewId: string; projectId?: string | null },
    ): Promise<{ html: string }> {
      const projectId = input.projectId ?? ''
      const catalog = await catalogFor(userId, projectId)
      return readViewHtml(catalog, input)
    },

    /** Absolute path of one bundled plugin's UI artifact file (confined — see ui-artifact.ts). */
    async resolveUiFile(userId, input) {
      return resolvePluginUiFile(await catalogFor(userId, ''), input.pluginName, input.file)
    },

    /**
     * Same-plugin UI RPC. The browser supplies only an action + payload; this
     * service re-authorizes the exact discovery scope and binds identity/cwd.
     */
    async invokeUiAction(userId, input) {
      if (!deps.invokeUiAction) {
        throw new UnavailableError(
          'plugin_ui_actions_unavailable',
          'Plugin UI actions are unavailable',
        )
      }
      const projectId = input.projectId ?? ''
      const catalog = await catalogFor(userId, projectId)
      const entry = catalog.enabled.find(
        ({ plugin }) => plugin.manifest.name === input.pluginName && plugin.projectId === projectId,
      )
      if (!entry) {
        throw new NotFoundError(
          'plugin_not_enabled',
          `Plugin "${input.pluginName}" is not enabled in this scope`,
        )
      }

      const sessionCwd = input.sessionId
        ? await deps.resolveSessionCwd?.(userId, input.sessionId)
        : null
      if (input.sessionId && !sessionCwd) {
        throw new NotFoundError('session_not_found', 'Session not found')
      }
      const projectCwd = projectId ? await cwdFor(userId, projectId) : null
      const payload = jsonValueWithinCap(input.payload, 'Plugin UI action payload')
      try {
        const result = await deps.invokeUiAction({
          pluginName: input.pluginName,
          action: input.action,
          payload,
          context: {
            userId,
            projectId,
            cwd: sessionCwd ?? projectCwd ?? localixWorkspaceDir(),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            viewId: input.viewId,
          },
        })
        return { result: jsonValueWithinCap(result, 'Plugin UI action result') }
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code
        if (code === 'not_available') {
          throw new NotFoundError('plugin_ui_action_not_found', errorMessage(err))
        }
        if (code === 'ambiguous') {
          throw new ConflictError('plugin_ui_action_ambiguous', errorMessage(err))
        }
        if (code === 'timeout') {
          throw new UnavailableError('plugin_ui_action_timeout', errorMessage(err))
        }
        throw err
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

    /**
     * Resolve the DYNAMIC options for one plugin-command arg by running the plugin's
     * declared `optionsScript` in the session cwd. Fully agnostic — the core just runs
     * the script + parses `ArgOption[]`; it never knows what the values mean. Only for
     * an ENABLED plugin, with the script path confined to the plugin dir.
     * Never throws — any failure yields `[]`.
     */
    async resolvePluginArgOptions(userId, input) {
      try {
        const projectId = input.projectId ?? ''
        const catalog = await catalogFor(userId, projectId)
        const entry = catalog.enabled.find((e) => e.plugin.manifest.name === input.plugin)
        if (!entry) return { options: [] }
        const cmd = entry.plugin.commands.find((c) => c.name === input.command)
        const arg = cmd?.args.find((a) => a.name === input.arg)
        if (!arg?.optionsScript) return { options: [] }

        const scriptAbs = confineToDir(entry.plugin.dir, arg.optionsScript)
        if (!scriptAbs) return { options: [] } // path escaped the plugin dir

        const sessionCwd = input.sessionId
          ? await deps.resolveSessionCwd?.(userId, input.sessionId)
          : null
        const cwd =
          sessionCwd ??
          (projectId ? await cwdFor(userId, projectId) : null) ??
          localixWorkspaceDir()

        const config = resolvePluginConfig(entry.plugin.manifest, scalarConfig(entry.state?.config))
        const stdout = await runArgOptionsScript({
          scriptAbsPath: scriptAbs,
          cwd,
          request: {
            query: input.query ?? '',
            cwd,
            sessionId: input.sessionId,
            argName: input.arg,
            command: input.command,
            config,
          },
        })
        return { options: parseArgOptions(stdout) }
      } catch (err) {
        deps.logger?.warn?.('plugin arg-options failed', { err: errorMessage(err) })
        return { options: [] }
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

    async onPolicyChanged(_userId, scope, names) {
      for (const name of names) invalidateInspection(name, scope.projectId ?? '')
      deps.onChanged?.()
    },

    async setEnabled(userId, input) {
      const projectId = input.projectId ?? ''
      const plugin = await requirePlugin(userId, input.name, projectId)
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
      const state = (await repo.get(userId, projectId, input.name)) ?? undefined
      invalidateInspection(plugin.manifest.name, projectId)
      deps.onChanged?.()
      const record = await toRecord(
        userId,
        plugin,
        state,
        await verdictFor(userId, plugin, input.agentId),
      )
      if (cascade?.result.warnings.length) {
        record.validation.warnings.push(...cascade.result.warnings)
      }
      return record
    },

    async setConfig(userId, input) {
      const projectId = input.projectId ?? ''
      const plugin = await requirePlugin(userId, input.name, projectId)
      const patch = configPatchValues(plugin.manifest.config ?? {}, input.values)
      const state = await repo.patchConfig(userId, projectId, input.name, patch)
      invalidateInspection(plugin.manifest.name, projectId)
      deps.onChanged?.()
      return toRecord(userId, plugin, state, await verdictFor(userId, plugin))
    },

    async install(userId, input, opts?: { replace?: boolean }) {
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
      // Validate the actual copied tree before it becomes discoverable. Marketplace
      // overlays belong to preparation too: their failures must preserve the live tree.
      const prepare = async (directory: string) => {
        // A Claude Code plugin loads in place; what Localix does not run is said once, here.
        if (resolvedMarket) await applyEntryManifestOverrides(directory, resolvedMarket.entry)
        const candidate = await loadManifest(directory, scope, projectId)
        if (candidate.error) throw new InvalidRequestError('plugin_invalid', candidate.error)
        installNotes.push(
          ...(candidate.layoutIssues ?? []).map((found) => `${found.path}: ${found.message}`),
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
            parent,
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
      invalidateInspection(plugin.manifest.name, projectId)
      deps.onChanged?.()
      const record = await toRecord(
        userId,
        plugin,
        state,
        await verdictFor(userId, plugin),
        cwd ?? localixWorkspaceDir(),
      )
      installNotes.push(...warnings)
      if (installNotes.length) record.validation.warnings.push(...installNotes)
      return record
    },

    async update(userId, input) {
      // Re-install from the original source (mirrors CC `plugin update`).
      const projectId = input.projectId ?? ''
      const states = await repo.listForScope(userId, projectId)
      const state = states.find((s) => s.name === input.name)
      if (!state?.source || state.source === 'local') {
        throw new InvalidRequestError(
          'plugin_no_source',
          `Plugin "${input.name}" has no recorded install source — drop in the updated folder manually.`,
        )
      }

      // Installation owns staging and rollback. Omitting enable preserves the existing
      // rules rather than copying a stale availability decision into a new policy write.
      return service.install(
        userId,
        { source: state.source, projectId: projectId || null },
        { replace: true },
      )
    },

    async remove(userId, input) {
      const projectId = input.projectId ?? ''
      const cwd = projectId ? await cwdFor(userId, projectId) : null
      const discovered = await discover({ cwd, projectId })
      const plugin =
        discovered.find((p) => p.manifest.name === input.name && p.projectId === projectId) ?? null
      // Nothing to remove used to answer like a removal, so `/plugin remove typo` said "Removed".
      if (!plugin && !(await repo.get(userId, projectId, input.name)))
        throw new NotFoundError('plugin_not_found', `Plugin "${input.name}" is not installed`)
      // Claude Code owns what it installed; Localix reads that folder in place. Turning the
      // plugin off here is the part that is ours to change.
      if (plugin?.claudeCodeInstall) {
        await service.setEnabled(userId, {
          name: input.name,
          projectId: projectId || null,
          enabled: false,
        })
        return { warnings: [], claudeCodeInstall: plugin.claudeCodeInstall }
      }
      // NO cascade on remove — dependents keep working off their own state — but WARN
      // when other installed plugins still declare a dependency on the removed one.
      const dependents = listDependents(input.name, discovered)
      await repo.remove(userId, projectId, input.name)
      // A bundled plugin is a shared managed artifact projected into every
      // scope. Removing one scope must never delete the code used by the others.
      if (plugin && !plugin.bundled) {
        await removeIfUnderRoot(plugin.dir, pluginInstallRoot(plugin.scope, cwd, home))
      }
      invalidateInspection(input.name, projectId)
      deps.onChanged?.()
      if (dependents.length) {
        const warning = `"${input.name}" was removed, but other installed plugin(s) still depend on it: ${dependents.join(', ')}.`
        deps.logger?.warn?.(warning)
        return { warnings: [warning] }
      }
      return undefined
    },

    ...createMarketplaceMethods({
      registryDeps,
      repo,
      update: (userId, name) => service.update(userId, { name }),
      remove: (userId, name) => service.remove(userId, { name }),
    }),

    // `/plugin reload` (CC's /reload-plugins) compat: fire the change notification so channels restart,
    // catalog caches clear, and the next run picks up fresh discovery results.
    onChanged: deps.onChanged
      ? () => {
          invalidateInspection()
          deps.onChanged!()
        }
      : undefined,

    authoring: createPluginAuthoring({
      discover: () => discover({ cwd: null, projectId: '' }),
      pluginsRoot: pluginInstallRoot('global', null, home),
      kitDir: deps.pluginKitDir ?? pluginKitDir,
      installedSource: async (userId, name) => (await repo.get(userId, '', name))?.source ?? null,
      enable: (userId, name) => service.setEnabled(userId, { name, enabled: true }),
      disable: (userId, name) => service.setEnabled(userId, { name, enabled: false }),
      changed: () => service.onChanged?.(),
    }),
  }
  return service
}
