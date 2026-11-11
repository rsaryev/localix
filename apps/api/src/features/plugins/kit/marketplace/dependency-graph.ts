import { startUninstall } from '@rsaryev/llx-plugin/cli'
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

/**
 * A manifest's or an entry's `dependencies` as the kit reads them (`normalizeDependency`:
 * `"name"`, `"name@marketplace"`, `{ name, marketplace?, version? }` with `version` the `range`),
 * once per name, the first winning. An item the kit refuses is left out: its validation reports it.
 */
export function declaredDependencies(raw: unknown): NormalizedDependency[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((item, index) => {
    const dep = normalizeDependency(item, undefined, `dependencies[${index}]`)
    if ('severity' in dep || seen.has(dep.name)) return []
    seen.add(dep.name)
    return [dep]
  })
}

/** The dependencies, each known by its name alone. */
const dependenciesOf = (raw: unknown): NormalizedDependency[] =>
  declaredDependencies(raw).map(({ name, range }) => ({
    name,
    ...(range === undefined ? {} : { range }),
  }))

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

/**
 * The enabled plugins that still need `id` when it is uninstalled from `scope`: the `requiredBy` of
 * the kit's `startUninstall` (not refused, as in Claude Code; the dependents then fail to load).
 */
export function uninstallRequiredBy(
  id: string,
  scope: 'user' | 'project',
  facts: Pick<GraphFacts, 'installed' | 'enabled'>,
): readonly string[] {
  const graph = { ...facts, catalog: {}, allowlists: {} }
  const start = startUninstall({ plugin: id, scope }, { graph, tty: false })
  return start.kind === 'remove' ? start.requiredBy : []
}
