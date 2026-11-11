import { InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import type { MarketplaceEntry, NormalizedDependency } from '@rsaryev/llx-plugin/marketplace'

/**
 * Plugin-to-plugin dependencies (Claude Code `plugin.json` `dependencies`).
 *
 * PURE resolution layer: normalizing the manifest field, planning which missing
 * dependencies to install from which marketplace (enforcing the parent catalog's
 * `allowCrossMarketplaceDependenciesOn` restriction) and advisory semver checks. All I/O is injected so the logic is unit-testable.
 * The install write-phase lives in `dependencies-install.ts`; the enable cascade
 * in `dependencies-enable.ts`.
 *
 * A version range on a git-backed dependency installs the highest `<plugin>--v<version>` tag in
 * range (`dependency-tags.ts`); a relative-path one installs the marketplace's copy and is
 * checked against the range.
 *
 * DEFERRED (documented, not silently dropped):
 *  - dependency resolution for NON-marketplace installs (git URL / local path) —
 *    those installs have no parent catalog; declared dependencies are only checked
 *    at enable time (cascade warns about missing ones).
 */

/**
 * Advisory semver check: a version-pinned dependency whose resolved source declares a
 * version that does not satisfy the range yields a WARNING naming both — never a hard
 * failure (CC treats ranges as hints too). Unknown/unparseable versions warn nothing.
 */
export function dependencyVersionWarning(
  dep: NormalizedDependency,
  resolvedVersion: string | undefined,
  where: string,
): string | null {
  if (!dep.range || !resolvedVersion) return null
  try {
    if (Bun.semver.satisfies(resolvedVersion, dep.range)) return null
  } catch {
    return null // unparseable range/version — advisory check, stay silent
  }
  return `Dependency "${dep.name}" wants version "${dep.range}" but ${where} has "${resolvedVersion}" — installing anyway (version pins are advisory).`
}

/** One planned dependency install: a marketplace entry resolved to a local dir. */
export interface ResolvedDependencyStep {
  name: string
  marketplace: string
  /** Local dir ready for `installFromLocal` (marketplace-relative or staged remote). */
  dir: string
  /** Where `dir`'s symlinks may be dereferenced from: its marketplace or fetched checkout. */
  linkRoot?: string
  entry: MarketplaceEntry
  version?: string
  /** The step's OWN dependencies (for transitive planning). */
  dependencies: NormalizedDependency[]
}

export interface DependencyPlan {
  /** Missing dependencies to install, in resolution (dependency-first is NOT guaranteed) order. */
  steps: ResolvedDependencyStep[]
  warnings: string[]
}

/** Injected I/O the planner needs — the service binds these to the marketplace registry. */
export interface DependencyResolverDeps {
  /** Already-installed/bundled plugins in scope: name → declared version (if any). */
  installed: Map<string, string | undefined>
  findMarketplacesWithPlugin(name: string): Promise<string[]>
  /** `range`: the dependency's version range, resolved against `<name>--v<version>` tags. */
  resolveFromMarketplace(
    name: string,
    marketplace: string,
    range?: string,
  ): Promise<ResolvedDependencyStep>
  /** The catalog's `allowCrossMarketplaceDependenciesOn` list ([] when absent/unreadable). */
  getAllowList(marketplace: string): Promise<string[]>
  /** Ranges other installed plugins put on a dependency, each with the plugin that set it. */
  constraints?: Map<string, Array<{ range: string; by: string }>>
  /** The versions a marketplace can install a plugin at (its release tags), when it has any. */
  versionsOf?(name: string, marketplace: string): Promise<string[]>
}

const satisfies = (version: string | undefined, range: string) => {
  try {
    return version !== undefined && Bun.semver.satisfies(version, range)
  } catch {
    return true // an unparseable range constrains nothing
  }
}

/**
 * Resolve a dependency list to an install plan WITHOUT writing anything — every
 * resolution failure (missing plugin, cross-marketplace restriction) throws a typed
 * ApiError here, BEFORE the install touches disk, so a failed install is atomic.
 *
 * Order per dependency: already installed (satisfied, advisory version check) →
 * the parent's own marketplace → marketplaces the parent catalog explicitly allows
 * via `allowCrossMarketplaceDependenciesOn` (others are an error naming the
 * restriction). Transitive: each planned step's own dependencies are resolved with
 * that step's marketplace as the new parent. Cycle-safe via a visited set.
 */
export async function resolveDependencyPlan(
  rootDeps: NormalizedDependency[],
  parentMarketplace: string,
  deps: DependencyResolverDeps,
): Promise<DependencyPlan> {
  const steps: ResolvedDependencyStep[] = []
  const warnings: string[] = []
  const visited = new Set<string>()

  const visit = async (list: NormalizedDependency[], from: string): Promise<void> => {
    for (const dep of list) {
      if (visited.has(dep.name)) continue // cycle / diamond — already handled
      visited.add(dep.name)

      // Every range on the dependency, this plugin's and the installed plugins' (dependencies.md,
      // "Combine constraints from several plugins").
      const ranges = [
        ...(dep.range ? [{ range: dep.range, by: 'this plugin' }] : []),
        ...(deps.constraints?.get(dep.name) ?? []),
      ]
      const combined = ranges.map((found) => found.range).join(' ')
      if (deps.installed.has(dep.name)) {
        const version = deps.installed.get(dep.name)
        // Another plugin's range is on it too and the installed copy misses one: it moves to a
        // version every range admits (resolved below), or the install is refused.
        const moves = ranges.length > 1 && !ranges.every((found) => satisfies(version, found.range))
        if (!moves) {
          const w = dependencyVersionWarning(dep, version, 'the installed plugin')
          if (w) warnings.push(w)
          continue // satisfied; its own deps were handled when IT was installed
        }
      }

      const named = dep.marketplace
      const hits = (await deps.findMarketplacesWithPlugin(dep.name)).filter(
        (market) => !named || market === named,
      )
      let chosen: string | null = hits.includes(from) ? from : null
      if (!chosen && hits.length > 0) {
        const allow = await deps.getAllowList(from)
        chosen = allow.find((m) => hits.includes(m)) ?? null
        if (!chosen) {
          throw new InvalidRequestError(
            'plugin_dependency_blocked',
            `Dependency "${named ? `${dep.name}@${named}` : dep.name}" is only available in marketplace(s) ${hits.map((h) => `"${h}"`).join(', ')}, but marketplace "${from}" does not allow cross-marketplace dependencies on ${allow.length ? `anything beyond ${allow.map((a) => `"${a}"`).join(', ')}` : 'any other marketplace'} (allowCrossMarketplaceDependenciesOn).`,
          )
        }
      }
      if (!chosen) {
        throw new NotFoundError(
          'plugin_dependency_missing',
          named
            ? `Dependency "${dep.name}@${named}" is not installed and marketplace "${named}" does not list it. Nothing was installed.`
            : `Dependency "${dep.name}" is not installed and was not found in marketplace "${from}" or any allowed marketplace. Nothing was installed.`,
        )
      }

      if (ranges.length > 1 && deps.versionsOf) {
        const versions = await deps.versionsOf(dep.name, chosen)
        if (versions.length && !versions.some((v) => ranges.every((r) => satisfies(v, r.range))))
          throw new InvalidRequestError(
            'plugin_dependency_conflict',
            `Dependency "${dep.name}" has conflicting version requirements: ${ranges.map((r) => `${r.range} (${r.by})`).join(', ')}. Nothing was installed.`,
          )
      }
      const step = await deps.resolveFromMarketplace(dep.name, chosen, combined || undefined)
      const w = dependencyVersionWarning(dep, step.version, `"${dep.name}@${chosen}"`)
      if (w) warnings.push(w)
      steps.push(step)
      await visit(step.dependencies, chosen)
    }
  }

  await visit(rootDeps, parentMarketplace)
  return { steps, warnings }
}
