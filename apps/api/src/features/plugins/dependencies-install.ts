import { basename } from 'node:path'
import type { InstallStep } from '@rsaryev/llx-plugin/marketplace'
import { InvalidRequestError } from '../../lib/domain-errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { ExtensionTreeInput } from '../ext/publish-trees'
import type { PluginCatalogEntry } from './catalog'
import { entrySource } from './claude-code-installs'
import { installedFacts } from './dependency-facts'
import { entryTags } from './dependency-tags'
import type { DiscoveredPlugin } from './discovery-types'
import { claimCachedRecord, versionedInstallFor } from './install-versioned'
import {
  planInstallClosure,
  readFetchedManifest,
  readKnownMarketplaces,
  type FetchedCopy,
} from './kit'
import { loadManifest } from './manifest-load'
import {
  closureMarketplaces,
  marketplacesRoot,
  parseMarketplaceRef,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { resolveMarketplaceInstall, type ResolvedMarketplaceInstall } from './marketplace-resolve'
import type { RecordClaim } from './publish-installation'

/**
 * The dependencies a marketplace install brings, planned by the kit (`planInstallClosure`, over
 * `installClosure`) BEFORE anything is written, so a refused plan installs nothing. Each plugin the
 * plan needs is fetched once and read as it was fetched; a step whose ranges resolved to a release
 * tag is fetched at that tag. The copies are then published with the parent's (`publication()`):
 * one file publication and one database commit, each copy recorded in `installed_plugins.json` as
 * the parent is (the version cache at user scope, the project's plugins root at project scope), so
 * each loads with its entry. A step that only enables an installed plugin is the enable cascade's.
 */

export interface DependencyPublicationContext {
  projectId: string
  userId: string
}

export interface PreparedDependencyInstall {
  /** What the plan left out, and what a fetched copy will fail at load. */
  warnings: string[]
  /** The names of the dependencies the install brings. */
  toInstall: string[]
  publication(context: DependencyPublicationContext): {
    trees: ExtensionTreeInput[]
    claims: RecordClaim[]
    write: (repo: CapabilitySourceRepository) => Promise<void>
  }
}

const FETCHES: ReadonlySet<InstallStep['action']> = new Set(['install', 'update'])

export interface DependencyPlanInput {
  resolved: ResolvedMarketplaceInstall
  registryDeps: MarketplaceRegistryDeps
  /** What is installed in the scope, with its state (`buildPluginCatalog`). */
  entries: readonly PluginCatalogEntry[]
  scope: 'global' | 'project'
}

/** The kit's plan of the closure, with the copies it fetched to read them. */
export async function planDependencies(input: DependencyPlanInput) {
  const { resolved, registryDeps } = input
  const known = await readKnownMarketplaces(registryDeps.root ?? marketplacesRoot())
  const fetched = new Map<string, ResolvedMarketplaceInstall>()
  const resolveCopy = (id: string, tag?: string) => {
    const ref = parseMarketplaceRef(id)
    if (!ref) throw new Error(`Dependency "${id}" names no marketplace`)
    return resolveMarketplaceInstall(ref, registryDeps, tag ? { tag } : undefined)
  }
  const copyOf = async (r: ResolvedMarketplaceInstall): Promise<FetchedCopy> => {
    const hostedBy = known[r.marketplace]?.source
    const tags = hostedBy ? await entryTags(r.entry, hostedBy, registryDeps) : []
    return { manifest: await readFetchedManifest(r.dir), ...(tags.length ? { tags } : {}) }
  }
  const root = `${resolved.entry.name}@${resolved.marketplace}`
  const plan = await planInstallClosure({
    root,
    scope: input.scope === 'global' ? 'user' : 'project',
    operation: 'install',
    rootCopy: await copyOf(resolved),
    ...installedFacts(input.entries),
    marketplaces: await closureMarketplaces(registryDeps),
    fetch: async (id) => {
      const r = await resolveCopy(id)
      fetched.set(id, r)
      return copyOf(r)
    },
  })
  return { plan, root, fetched, resolveCopy }
}

/** The plugins an install of `resolved` brings, by `name@marketplace` (the Store's `requires`). */
export async function dependenciesToInstall(input: DependencyPlanInput): Promise<string[]> {
  const { plan, root } = await planDependencies(input)
  return plan.steps
    .filter((step) => FETCHES.has(step.action) && step.id !== root)
    .map((step) => step.id)
}

export async function prepareDependenciesForInstall(
  input: DependencyPlanInput & {
    /** The project folder of a project-scope install. */
    projectPath: string | null
    installRoot: string
    home: string
    now: () => string
  },
): Promise<PreparedDependencyInstall> {
  const { plan, root, fetched, resolveCopy } = await planDependencies(input)
  if (plan.issues.length)
    throw new InvalidRequestError(
      'plugin_dependency_refused',
      `${plan.issues.map((issue) => issue.message).join('\n')}\nNothing was installed.`,
    )
  const steps = plan.steps.filter((step) => FETCHES.has(step.action) && step.id !== root)
  const copies = await Promise.all(
    steps.map(async (step) => {
      const tag = step.resolution?.tag
      const r = tag
        ? await resolveCopy(step.id, tag)
        : (fetched.get(step.id) ?? (await resolveCopy(step.id)))
      const versioned = await versionedInstallFor({
        resolved: r,
        inPlace: null,
        projectPath: input.projectPath,
        installRoot: input.installRoot,
        home: input.home,
      })
      return { step, r, versioned: versioned! }
    }),
  )
  const warnings = [
    ...plan.leftOut.map((one) => one.message),
    ...plan.steps.flatMap((step) => step.loadIssues.map((issue) => issue.message)),
  ]
  return {
    warnings,
    toInstall: copies.map(({ r }) => r.entry.name),
    publication(context) {
      const plugins: DiscoveredPlugin[] = []
      return {
        trees: copies.map(({ step, r, versioned }, index) => ({
          source: r.dir,
          name: basename(versioned.dir),
          root: versioned.root,
          linkRoot: r.linkRoot,
          // A version folder no record holds is one an uninstall orphaned; an update replaces.
          replace: !versioned.projectPath || step.action === 'update',
          prepare: async (staged: string) => {
            const at = entrySource(step.id, r.entry)
            const plugin = await loadManifest(staged, input.scope, context.projectId, at)
            if (plugin.error)
              throw new InvalidRequestError(
                'plugin_invalid',
                `dependency "${step.id}": ${plugin.error}`,
              )
            plugins[index] = plugin
          },
        })),
        claims: copies.map(
          ({ versioned }) =>
            () =>
              claimCachedRecord(input.home, versioned, input.now),
        ),
        write: async (repo) => {
          for (const [index, { step }] of copies.entries())
            await repo.upsert(context.userId, context.projectId, plugins[index]!.manifest.name, {
              source: step.id,
            })
        },
      }
    },
  }
}
