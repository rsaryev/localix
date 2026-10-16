import type { ExtensionTreeInput } from '../ext/publish-trees'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import { applyEntryManifestOverrides } from './marketplace-entry-manifest'
import { importClaudeCodePlugin } from './import-claude-code'
import type {
  CapabilitySourceRepository,
  CapabilitySourceRecord,
} from '../capabilities/source-repository'
import type { ContributionInput } from '../ext/contribution-kinds'
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
 *     The host combines them with parent files, contributions and policy in one publication.
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
    write: (repo: CapabilitySourceRepository) => Promise<
      Array<{
        source: CapabilitySourceRecord
        contributions: ContributionInput[]
      }>
    >
  }
}

/** Bind the pure planner's I/O to the real marketplace registry. */
export function marketplaceDependencyResolver(
  registryDeps: MarketplaceRegistryDeps,
  installed: Map<string, string | undefined>,
): DependencyResolverDeps {
  return {
    installed,
    findMarketplacesWithPlugin: (name) => findMarketplacesWithPlugin(name, registryDeps),
    getAllowList: (marketplace) => marketplaceDependencyAllowList(marketplace, registryDeps),
    resolveFromMarketplace: async (name, marketplace) => {
      const r = await resolveMarketplaceInstall({ plugin: name, marketplace }, registryDeps)
      return toDependencyStep(r, await probeManifest(r.dir))
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
  // Entry fields take precedence (CC: the catalog entry overrides plugin.json); the
  // raw manifest is consulted for the DECLARED version (zod defaults to "0.0.0").
  const rawVersion = probe?.rawManifest?.version
  const entryDeps = (r.entry as Record<string, unknown>).dependencies
  return {
    name: r.entry.name,
    marketplace: r.marketplace,
    dir: r.dir,
    entry: r.entry,
    version:
      r.entry.version ?? (typeof rawVersion === 'string' && rawVersion ? rawVersion : undefined),
    dependencies: normalizePluginDependencies(entryDeps ?? probe?.manifest.dependencies),
  }
}

/**
 * Plan the dependency installs for one resolved marketplace install. `discovered` is
 * the current plugin set in scope (installed + bundled) — those names are treated as
 * already satisfied (advisory version check only).
 */
export async function prepareDependenciesForInstall(
  resolved: ResolvedMarketplaceInstall,
  registryDeps: MarketplaceRegistryDeps,
  discovered: DiscoveredPlugin[],
): Promise<PreparedDependencyInstall> {
  const rootStep = toDependencyStep(resolved, await probeManifest(resolved.dir))
  const installed = new Map<string, string | undefined>(
    discovered.map((p) => [
      p.manifest.name,
      typeof p.rawManifest?.version === 'string' ? (p.rawManifest.version as string) : undefined,
    ]),
  )
  // A cycle back to the root is satisfied by the parent in this same publication.
  // Its own dependencies are already the traversal roots; never schedule its tree twice.
  installed.set(rootStep.name, rootStep.version)
  const resolver = marketplaceDependencyResolver(registryDeps, installed)
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
          prepare: async (staged) => {
            await importClaudeCodePlugin(staged, { source: `${step.name}@${step.marketplace}` })
            await applyEntryManifestOverrides(staged, step.entry)
            const plugin = await loadManifest(staged, ops.scope, ops.projectId)
            if (plugin.error) throw new Error(`dependency "${step.name}": ${plugin.error}`)
            plugins[index] = plugin
          },
        })),
        write: async (repo) => {
          const records = []
          for (const [index, step] of plan.steps.entries()) {
            const plugin = plugins[index]!
            const source = await repo.upsert(ops.userId, ops.projectId, plugin.manifest.name, {
              source: `${step.name}@${step.marketplace}`,
            })
            records.push({ source, contributions: plugin.manifest.contributions ?? [] })
          }
          return records
        },
      }
    },
  }
}
