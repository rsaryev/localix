import type { ExtensionTreeInput } from '../ext/publish-trees'
import { dependencyTagVersions } from './dependency-tag-versions'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import { applyEntryManifestOverrides } from './marketplace-entry-manifest'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import {
  findMarketplacesWithPlugin,
  marketplaceDependencyAllowList,
  resolveMarketplaceInstall,
  type MarketplaceRegistryDeps,
  type ResolvedMarketplaceInstall,
} from './marketplace-registry'
import {
  normalizePluginDependencies,
  resolveDependencyPlan,
  type DependencyPlan,
  type DependencyResolverDeps,
  type ResolvedDependencyStep,
} from './dependencies'

/**
 * Install-time dependency orchestration, split in two honest phases:
 *
 *  1. `prepareDependenciesForInstall` — PLAN ONLY. Resolves the full transitive
 *     dependency graph (throws typed errors on missing/blocked dependencies) before
 *     the install writes anything, so a failing install is atomic-by-ordering.
 *  2. `publication()` supplies staged trees and metadata writes for the parent installer.
 *     The host combines them with parent files and policy in one publication.
 *     Dependencies never commit themselves independently from their parent.
 */

/** What the write phase needs from the surrounding install flow. */
export interface DependencyPublicationContext {
  scope: 'global' | 'project'
  projectId: string
  userId: string
}

export interface PreparedDependencyInstall {
  plan: DependencyPlan
  /** Advisory notes from planning (semver mismatches) + committing. */
  warnings: string[]
  /** Names of dependencies satisfied by the plan (to be installed). */
  toInstall: string[]
  publication(context: DependencyPublicationContext): {
    trees: ExtensionTreeInput[]
    write: (repo: CapabilitySourceRepository) => Promise<void>
  }
}

/** Bind the pure planner's I/O to the real marketplace registry. */
export function marketplaceDependencyResolver(
  registryDeps: MarketplaceRegistryDeps,
  installed: Map<string, string | undefined>,
  constraints?: DependencyResolverDeps['constraints'],
): DependencyResolverDeps {
  return {
    installed,
    ...(constraints ? { constraints } : {}),
    versionsOf: (name, marketplace) => dependencyTagVersions(name, marketplace, registryDeps),
    findMarketplacesWithPlugin: (name) => findMarketplacesWithPlugin(name, registryDeps),
    getAllowList: (marketplace) => marketplaceDependencyAllowList(marketplace, registryDeps),
    resolveFromMarketplace: async (name, marketplace, range) => {
      const r = await resolveMarketplaceInstall(
        { plugin: name, marketplace },
        registryDeps,
        range ? { versionRange: range } : undefined,
      )
      const step = toDependencyStep(r, await probeManifest(r.dir))
      // A tag-resolved dependency is checked by the tag's version, not by its plugin.json.
      return r.tagVersion ? { ...step, version: r.tagVersion } : step
    },
  }
}

/** Best-effort manifest read of a resolved (pre-install) plugin dir. */
async function probeManifest(dir: string): Promise<DiscoveredPlugin | null> {
  try {
    const probe = await loadManifest(dir, 'global', '')
    return probe.error ? null : probe
  } catch {
    return null // strict:false entry-as-manifest dirs may have no plugin.json
  }
}

/** Merge a resolved entry + optional manifest probe into a planner step. */
function toDependencyStep(
  r: ResolvedMarketplaceInstall,
  probe: DiscoveredPlugin | null,
): ResolvedDependencyStep {
  // The DECLARED plugin.json version wins over the entry's (Claude Code), so the raw manifest is
  // read (zod defaults to "0.0.0"); entry dependencies take precedence over the manifest's.
  const rawVersion = probe?.rawManifest?.version
  const entryDeps = (r.entry as Record<string, unknown>).dependencies
  return {
    name: r.entry.name,
    marketplace: r.marketplace,
    dir: r.dir,
    linkRoot: r.linkRoot,
    entry: r.entry,
    version:
      (typeof rawVersion === 'string' && rawVersion ? rawVersion : undefined) ?? r.entry.version,
    dependencies: normalizePluginDependencies(entryDeps ?? probe?.manifest.dependencies),
  }
}

/**
 * Plan the dependency installs for one resolved marketplace install. `discovered` is
 * the current plugin set in scope (installed + bundled) — those names are treated as
 * already satisfied (advisory version check only), a project's own plugins only for a
 * project install, as Claude Code counts a dependency at the scope that needs it.
 */
export async function prepareDependenciesForInstall(
  resolved: ResolvedMarketplaceInstall,
  registryDeps: MarketplaceRegistryDeps,
  discovered: DiscoveredPlugin[],
  /** The scope the plugin installs to: a project's copy does not satisfy a user-wide install. */
  scope?: 'global' | 'project',
): Promise<PreparedDependencyInstall> {
  const rootStep = toDependencyStep(resolved, await probeManifest(resolved.dir))
  const reachable = discovered.filter((p) => scope !== 'global' || p.scope === 'global')
  const installed = new Map<string, string | undefined>(
    reachable.map((p) => [
      p.manifest.name,
      typeof p.rawManifest?.version === 'string' ? (p.rawManifest.version as string) : undefined,
    ]),
  )
  // A cycle back to the root is satisfied by the parent in this same publication.
  // Its own dependencies are already the traversal roots; never schedule its tree twice.
  installed.set(rootStep.name, rootStep.version)
  // The ranges the other installed plugins put on each dependency (dependencies.md, "Combine
  // constraints from several plugins").
  const constraints = new Map<string, Array<{ range: string; by: string }>>()
  for (const plugin of reachable) {
    if (plugin.manifest.name === rootStep.name) continue
    for (const dep of normalizePluginDependencies(plugin.manifest.dependencies))
      if (dep.version)
        constraints.set(dep.name, [
          ...(constraints.get(dep.name) ?? []),
          { range: dep.version, by: plugin.manifest.name },
        ])
  }
  const resolver = marketplaceDependencyResolver(registryDeps, installed, constraints)
  const plan = await resolveDependencyPlan(rootStep.dependencies, resolved.marketplace, resolver)

  return {
    plan,
    warnings: [...plan.warnings],
    toInstall: plan.steps.map((s) => s.name),
    publication(ops) {
      const plugins: DiscoveredPlugin[] = []
      return {
        trees: plan.steps.map((step, index) => ({
          source: step.dir,
          name: step.entry.name,
          linkRoot: step.linkRoot,
          // An installed dependency the combined ranges move to another version is replaced.
          ...(installed.has(step.name) && step.name !== rootStep.name ? { replace: true } : {}),
          prepare: async (staged) => {
            await applyEntryManifestOverrides(staged, step.entry)
            const plugin = await loadManifest(staged, ops.scope, ops.projectId)
            if (plugin.error) throw new Error(`dependency "${step.name}": ${plugin.error}`)
            plugins[index] = plugin
          },
        })),
        write: async (repo) => {
          for (const [index, step] of plan.steps.entries()) {
            const plugin = plugins[index]!
            await repo.upsert(ops.userId, ops.projectId, plugin.manifest.name, {
              source: `${step.name}@${step.marketplace}`,
            })
          }
        },
      }
    },
  }
}
