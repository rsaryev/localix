import type { DiscoveredPlugin } from './discovery'
import { normalizePluginDependencies } from './dependencies'

/**
 * Enable cascade for plugin dependencies: enabling a plugin also enables its
 * installed-but-disabled dependencies, as in Claude Code. A plugin runs no Localix code of its
 * own, so there is nothing a dependency list could switch on without consent.
 */
export interface DependencyEnableResult {
  /** Dependencies this cascade actually enabled (were installed but disabled). */
  enabled: string[]
  /** Declared dependencies that are not installed at all. */
  missing: string[]
  /** Human-readable summary lines for `missing` (empty when clean). */
  warnings: string[]
}

export interface DependencyEnableOps {
  /** Every discovered plugin in scope (the cascade looks dependencies up by name). */
  discovered: DiscoveredPlugin[]
  /** Current effective availability from capability policy and the native trust default. */
  isEnabled(plugin: DiscoveredPlugin): boolean
  /** Persist an allow rule for one plugin in its own scope. */
  enable(plugin: DiscoveredPlugin): Promise<void>
}

/**
 * Walk `root`'s dependency graph depth-first (cycle-safe via a visited set) and
 * enable every installed, currently-disabled dependency. Missing dependencies are advisory. Storage failures propagate so the
 * caller can roll back its transaction, including the parent and prior dependency writes.
 */
export async function cascadeEnableDependencies(
  root: DiscoveredPlugin,
  ops: DependencyEnableOps,
): Promise<DependencyEnableResult> {
  const result: DependencyEnableResult = {
    enabled: [],
    missing: [],
    warnings: [],
  }
  const visited = new Set<string>([root.manifest.name])

  const visit = async (plugin: DiscoveredPlugin): Promise<void> => {
    for (const dep of normalizePluginDependencies(plugin.manifest.dependencies)) {
      if (visited.has(dep.name)) continue
      visited.add(dep.name)
      // Dependencies never cross the project/no-project boundary.
      const found = ops.discovered.find(
        (p) => p.manifest.name === dep.name && p.projectId === plugin.projectId,
      )
      if (!found) {
        result.missing.push(dep.name)
        continue
      }
      if (!ops.isEnabled(found)) {
        // As in Claude Code: a dependency is enabled with the plugin that needs it.
        await ops.enable(found)
        result.enabled.push(dep.name)
      }
      await visit(found)
    }
  }

  await visit(root)
  if (result.missing.length) {
    result.warnings.push(`Declared dependencies are not installed: ${result.missing.join(', ')}.`)
  }
  return result
}
