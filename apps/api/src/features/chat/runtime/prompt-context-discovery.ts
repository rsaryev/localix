import type { AvailabilityReader } from '../../capabilities/availability'
import { loadEnabledMiniApps } from '../../mini-apps/loader'
import { emptyLoadedMiniApps } from '../../mini-apps/loader-contract'
import { recordMiniAppCatalogLoad } from '../../notifications/conditions/mini-apps'
import { recordPluginCatalogLoad } from '../../notifications/conditions/plugins'
import { loadEnabledPlugins } from '../../plugins/loader'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { userHome } from '../../../lib/env'
import { prefixedWarnLogger } from './plugin-hook-logger'
import type { PromptContextDeps } from './prompt-context-contracts'

/**
 * Everything a run's prompt discovers that depends only on its scope (user, project, working
 * directory, agent): the enabled plugins and mini apps.
 * `prepareRunContext` shares one answer across the scope (`runScopes`), so a spawned child that
 * inherits its parent's directory does not re-`register()` every plugin.
 */
export function loadScopeDiscovery(
  ctx: PromptContextDeps,
  scope: { userId: string; projectId: string; cwd: string; availability: AvailabilityReader },
) {
  return Promise.all([
    // Plugins: discover + load the user's ENABLED plugins for this scope. The
    // enable-state is the trust gate — only enabled plugins' native code is
    // imported. Their bundled skills, MCP servers and native tools fold into the
    // same pipelines built-ins use. Failures are isolated per-plugin and never
    // block the turn.
    loadEnabledPlugins({
      homeDir: userHome(),
      repo: ctx.pluginRepo,
      pluginHost: ctx.pluginHost,
      availability: scope.availability,
      userId: scope.userId,
      projectId: scope.projectId,
      cwd: scope.cwd,
      now: ctx.now,
      logger: prefixedWarnLogger('plugin'),
    })
      // The load as a whole is a standing condition of this scope
      // (`notifications/conditions/plugins.ts`): raised when it throws, settled when it works.
      .then((loaded) => {
        recordPluginCatalogLoad(scope.userId, scope.projectId)
        return loaded
      })
      .catch((err) => {
        console.warn('[agent-runner] plugin load failed', err)
        recordPluginCatalogLoad(scope.userId, scope.projectId, err)
        return emptyLoadedPlugins()
      }),
    // Mini apps: the enabled ones' backends (agent tools, hooks, memory), prompt sections and
    // guides. Their own load, beside the plugins': the two share nothing.
    loadEnabledMiniApps({
      homeDir: userHome(),
      repo: ctx.miniAppRepo,
      availability: scope.availability,
      userId: scope.userId,
      projectId: scope.projectId,
      cwd: scope.cwd,
      logger: prefixedWarnLogger('mini-app'),
      // The user is the host's to bind (it is part of this scope's key); the session is the
      // app's to state, because one scope serves a parent and its children.
      ...(ctx.publishMiniAppProblem
        ? {
            reportProblem: (app, problem) =>
              ctx.publishMiniAppProblem!({ userId: scope.userId, app, ...problem }),
          }
        : {}),
      ...(ctx.miniAppSessionStorage ? { sessionStorageFor: ctx.miniAppSessionStorage } : {}),
      ...(ctx.miniAppAgentDirectory ? { agentDirectory: ctx.miniAppAgentDirectory } : {}),
      ...(ctx.miniAppDecisions ? { decisionsFor: ctx.miniAppDecisions } : {}),
      ...(ctx.miniAppSemantic ? { semanticFor: ctx.miniAppSemantic } : {}),
    })
      // Its own standing condition (`notifications/conditions/mini-apps.ts`).
      .then((loaded) => {
        recordMiniAppCatalogLoad(scope.userId, scope.projectId)
        return loaded
      })
      .catch((err) => {
        console.warn('[agent-runner] mini app load failed', err)
        recordMiniAppCatalogLoad(scope.userId, scope.projectId, err)
        return emptyLoadedMiniApps()
      }),
  ])
}
