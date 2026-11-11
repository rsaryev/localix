import type { DiscoveredPlugin } from './discovery'
import { enableCascade } from './kit'

/**
 * Enabling a plugin with dependencies, as Claude Code does it (the kit's `enablePlan`): its
 * installed dependencies that are off are enabled with it, dependencies first; one that is not
 * installed fails the enable, which then enables nothing. Dependencies never cross the
 * project/no-project boundary. A plugin runs no Localix code of its own, so there is nothing a
 * dependency list could switch on without consent.
 */
export interface DependencyEnableResult {
  /** The dependencies to enable with the plugin (installed but off). */
  enable: DiscoveredPlugin[]
  /** Why the plugin cannot be enabled: a dependency that is not installed. Nothing is enabled then. */
  issues: string[]
}

export function planEnableCascade(
  root: DiscoveredPlugin,
  discovered: readonly DiscoveredPlugin[],
  isEnabled: (plugin: DiscoveredPlugin) => boolean,
): DependencyEnableResult {
  const inScope = discovered.filter((plugin) => plugin.projectId === root.projectId)
  const nodes = [root, ...inScope.filter((plugin) => plugin !== root)].map((plugin) => ({
    name: plugin.manifest.name,
    enabled: isEnabled(plugin),
    dependencies: plugin.manifest.dependencies,
  }))
  const plan = enableCascade(root.manifest.name, nodes)
  const byName = new Map(inScope.map((plugin) => [plugin.manifest.name, plugin]))
  return {
    enable: plan.enable.flatMap((name) => byName.get(name) ?? []),
    issues: [...plan.issues],
  }
}
