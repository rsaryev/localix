import type { DiscoveredPlugin } from './discovery'
import { normalizePluginDependencies } from './dependencies'

/**
 * Enable cascade for plugin dependencies: enabling a plugin also enables its
 * installed-but-disabled dependencies — EXCEPT any the trust gate would clamp.
 *
 * The hard rule mirrors `enable.ts`: a non-bundled, code-bearing plugin (native
 * in-process tools) is NEVER switched on by anything other than an explicit user
 * action — a parent plugin's dependency list is not consent to run code. Those
 * stay off and are reported in `manualRequired` + a human-readable warning.
 */
export interface DependencyEnableResult {
  /** Dependencies this cascade actually enabled (were installed but disabled). */
  enabled: string[]
  /** Code-bearing, non-bundled dependencies the user must enable manually (trust gate). */
  manualRequired: string[]
  /** Declared dependencies that are not installed at all. */
  missing: string[]
  /** Human-readable summary lines for `manualRequired` + `missing` (empty when clean). */
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
 * enable every installed, currently-disabled dependency that the trust gate allows.
 * Missing or trust-blocked dependencies are advisory. Storage failures propagate so the
 * caller can roll back its transaction, including the parent and prior dependency writes.
 */
export async function cascadeEnableDependencies(
  root: DiscoveredPlugin,
  ops: DependencyEnableOps,
): Promise<DependencyEnableResult> {
  const result: DependencyEnableResult = {
    enabled: [],
    manualRequired: [],
    missing: [],
    warnings: [],
  }
  const visited = new Set<string>([root.manifest.name])

  const visit = async (plugin: DiscoveredPlugin): Promise<void> => {
    for (const dep of normalizePluginDependencies(plugin.manifest.dependencies)) {
      if (visited.has(dep.name)) continue
      visited.add(dep.name)
      // Dependencies never cross the project/no-project boundary. Managed bundled
      // artifacts are projected into each scope during discovery, so they still
      // resolve here without borrowing another scope's state.
      const found = ops.discovered.find(
        (p) => p.manifest.name === dep.name && p.projectId === plugin.projectId,
      )
      if (!found) {
        result.missing.push(dep.name)
        continue
      }
      if (!ops.isEnabled(found)) {
        if (found.provides.hasNativeTools && !found.bundled) {
          // Trust gate: dependency declarations never auto-run third-party native code.
          result.manualRequired.push(dep.name)
          continue // do not descend into a plugin we refused to enable
        }
        await ops.enable(found)
        result.enabled.push(dep.name)
      }
      await visit(found)
    }
  }

  await visit(root)
  if (result.manualRequired.length) {
    result.warnings.push(
      `Dependencies with native code were NOT auto-enabled (enable them manually): ${result.manualRequired.join(', ')}.`,
    )
  }
  if (result.missing.length) {
    result.warnings.push(`Declared dependencies are not installed: ${result.missing.join(', ')}.`)
  }
  return result
}
