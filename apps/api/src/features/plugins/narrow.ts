import type { LoadedPlugins } from './loader'

/** The prefix `buildMcpRecords` gives every server it synthesizes for a plugin. */
const mcpIdPrefix = (pluginName: string) => `plugin:${pluginName}:`

/**
 * Subtract the plugins ONE AGENT may not use from a set loaded for the whole SCOPE.
 *
 * Loading is scope-shaped and deliberately shared: `runScopes` caches the filesystem walk and
 * the `register()` of every enabled plugin per (user, project, cwd), because a parent and its
 * children see the same directory. An agent's rules are NOT part of that key — and must not
 * be, or the cache would hold one agent's answer for every other one — so the load cannot
 * apply them. Whoever ran first would otherwise decide the plugin set for everyone after,
 * in either direction: an agent that denies a plugin keeping it, or an agent that allows one
 * losing it.
 *
 * So the load answers "what does this scope have" and this answers "what may this agent
 * reach". Only the per-RUN contributions are subtracted. Hooks, monitors, channels and
 * backends are the host's, reconciled once per scope and never per turn, so an agent scope
 * has nothing to say about them.
 *
 * Every subtraction goes through an attribution the loader wrote at push time. Matching on a
 * path prefix or a manifest-declared name instead would answer correctly for the plugins we
 * ship and silently stop answering for one that names things differently, and a filter that
 * silently matches nothing is the failure this whole seam exists to prevent.
 */
export function narrowLoadedPlugins(
  loaded: LoadedPlugins,
  deniedPlugins: readonly string[],
): LoadedPlugins {
  if (deniedPlugins.length === 0) return loaded
  const denied = new Set(deniedPlugins)
  const owned = loaded.loaded.filter((summary) => denied.has(summary.name))
  if (owned.length === 0) return loaded

  const deniedBinDirs = new Set(owned.flatMap((s) => (s.binDir ? [s.binDir] : [])))
  const deniedMcpIds = owned.map((summary) => mcpIdPrefix(summary.name))

  return {
    ...loaded,
    skills: loaded.skills.filter((skill) => !(skill.pluginName && denied.has(skill.pluginName))),
    mcpServers: loaded.mcpServers.filter(
      (server) => !deniedMcpIds.some((prefix) => server.id.startsWith(prefix)),
    ),
    binDirs: loaded.binDirs.filter((dir) => !deniedBinDirs.has(dir)),
    agents: loaded.agents.filter((agent) => !denied.has(agent.pluginName)),
    outputStyles: loaded.outputStyles.filter((entry) => !denied.has(entry.pluginName)),
    mainAgent:
      loaded.mainAgent && denied.has(loaded.mainAgent.pluginName) ? null : loaded.mainAgent,
    // The summary drives the prompt's plugin section and the diagnostics row, so a plugin
    // this agent cannot reach must not be announced to it as available.
    loaded: loaded.loaded.filter((summary) => !denied.has(summary.name)),
  }
}
