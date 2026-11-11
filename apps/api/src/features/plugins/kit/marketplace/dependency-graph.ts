import {
  disableDecision,
  enablePlan,
  normalizeDependency,
  type GraphFacts,
  type NormalizedDependency,
} from '@rsaryev/llx-plugin/marketplace'

/**
 * Enable and disable over the plugin dependency graph, judged by the kit (`enablePlan`,
 * `disableDecision`; plugins/install.md, "Plugins with dependencies"). Localix knows a plugin by its
 * manifest name, and its on/off state is its own policy, so every plugin is one install at user
 * scope whose `enabledPlugins` value is that state, and a dependency is matched by name.
 */

export interface PluginNode {
  readonly name: string
  readonly enabled: boolean
  /** The manifest's `dependencies`, as written. */
  readonly dependencies: unknown
}

/** The dependencies as the kit reads them, each known by its name alone. */
function dependenciesOf(raw: unknown): NormalizedDependency[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const dep = normalizeDependency(item, undefined)
    if ('severity' in dep) return []
    return [{ name: dep.name, ...(dep.range === undefined ? {} : { range: dep.range }) }]
  })
}

const factsOf = (plugins: readonly PluginNode[]): GraphFacts => ({
  installed: plugins.map((plugin) => ({
    id: plugin.name,
    scope: 'user',
    dependencies: dependenciesOf(plugin.dependencies),
  })),
  enabled: { user: Object.fromEntries(plugins.map((plugin) => [plugin.name, plugin.enabled])) },
  catalog: {},
  allowlists: {},
})

/** What enabling `name` also enables, dependencies first, or why it cannot be enabled. */
export function enableCascade(
  name: string,
  plugins: readonly PluginNode[],
): { enable: readonly string[]; issues: readonly string[] } {
  const plan = enablePlan(name, 'user', factsOf(plugins))
  return { enable: plan.enable, issues: plan.issues.map((issue) => issue.message) }
}

/** Why `name` cannot be disabled while enabled plugins still need it, or `undefined`. */
export function disableRefusal(name: string, plugins: readonly PluginNode[]): string | undefined {
  const decision = disableDecision(name, factsOf(plugins))
  return decision.allowed ? undefined : decision.message
}
