import { normalizePluginDependencies } from './dependencies'
import type { DiscoveredPlugin } from './discovery-types'

/**
 * Claude Code checks a dependency's version range when the plugins load (dependencies.md,
 * "Constrain a dependency that has a non-git source"): a dependent whose installed dependency
 * falls outside the range, or states no version at all, stays disabled with
 * `Requires "<dep>" <range>, installed <version>`. A dependency that is not installed is the
 * enable cascade's business, not this check's.
 */
export function withDependencyVersionChecks(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
  const versions = new Map<string, string | undefined>(
    plugins.map((plugin) => {
      const raw = plugin.rawManifest?.version
      return [plugin.manifest.name, typeof raw === 'string' && raw ? raw : undefined]
    }),
  )
  return plugins.map((plugin) => {
    if (plugin.error) return plugin
    for (const dependency of normalizePluginDependencies(plugin.manifest.dependencies)) {
      if (!dependency.version || !versions.has(dependency.name)) continue
      const installed = versions.get(dependency.name)
      let satisfied = false
      try {
        satisfied = installed !== undefined && Bun.semver.satisfies(installed, dependency.version)
      } catch {
        satisfied = true // an unparseable range constrains nothing
      }
      if (!satisfied)
        return {
          ...plugin,
          error: `Requires "${dependency.name}" ${dependency.version}, installed ${installed ?? 'with no version'}`,
        }
    }
    return plugin
  })
}
