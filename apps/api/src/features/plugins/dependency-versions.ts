import type { DiscoveredPlugin } from './discovery-types'
import { declaredDependencies, dependencyRangeIssue } from './kit'

/**
 * Claude Code checks a dependency's version range when the plugins load (dependencies.md,
 * "Constrain a dependency that has a non-git source"): a dependent whose installed dependency
 * falls outside the range, or states no version at all, stays disabled with the kit's
 * `Requires "<dep>" <range>, installed <version>`. A dependency that is not installed is the
 * enable cascade's business, not this check's.
 */
export function withDependencyVersionChecks(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
  const versions = new Map<string, string | undefined>(
    plugins.map((plugin) => [plugin.manifest.name, plugin.manifest.version || undefined]),
  )
  return plugins.map((plugin) => {
    if (plugin.error) return plugin
    for (const { name, range } of declaredDependencies(plugin.manifest.dependencies)) {
      if (range === undefined || !versions.has(name)) continue
      // Localix knows an installed plugin by its name: the range is judged against that copy.
      const error = dependencyRangeIssue({ name, range }, versions.get(name))
      if (error) return { ...plugin, error }
    }
    return plugin
  })
}
