import { resolve } from 'node:path'
import {
  planPluginFetch,
  withoutRoutingHeaders,
  type FetchPlan,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '@rsaryev/llx-plugin/marketplace'
import { isPathWithin } from '../../../../lib/path-containment'
import { issueLine } from '../catalog/read-folder'
import { cloneUrl } from './sources'

/**
 * Where one marketplace entry's plugin comes from, as the kit plans it (`planPluginFetch`), in the
 * shape Localix's transports take: a folder inside the marketplace, git coordinates, an npm
 * package, or an HTTPS archive. A `command` source is refused: Localix does not run one.
 */
export type ResolvedEntrySource =
  | { localPath: string }
  | { git: { url: string; subdir?: string; ref?: string } }
  | { npm: { package: string; tarball?: string; version?: string; registry?: string } }
  | {
      archive: {
        url: string
        sha256?: string
        headers?: Record<string, string>
        /** A command printing more headers, run only once the person accepts it. */
        headersHelper?: string
      }
    }

type Plan<K extends FetchPlan['kind']> = Extract<FetchPlan, { kind: K }>
type Resolve<K extends FetchPlan['kind']> = (
  plan: Plan<K>,
  entry: MarketplaceEntry,
  dir: string,
) => ResolvedEntrySource

const RESOLVE: { readonly [K in FetchPlan['kind']]: Resolve<K> } = {
  local: (plan, entry, dir) => {
    const localPath = resolve(dir, plan.fromMarketplaceRoot)
    if (!isPathWithin(resolve(dir), localPath))
      throw new Error(`Entry "${entry.name}" source resolves outside the marketplace`)
    return { localPath }
  },
  git: (plan) => {
    const ref = plan.sha ?? plan.ref
    return {
      git: {
        url: cloneUrl(plan.repo),
        ...(plan.subdir === undefined ? {} : { subdir: plan.subdir }),
        ...(ref === undefined ? {} : { ref }),
      },
    }
  },
  npm: (plan) => ({
    npm:
      'tarballUrl' in plan.spec
        ? { package: plan.spec.tarballUrl, tarball: plan.spec.tarballUrl }
        : {
            package: plan.spec.package,
            version: plan.spec.version,
            ...(plan.registry === undefined ? {} : { registry: plan.registry }),
          },
  }),
  archive: (plan, entry) => ({
    archive: {
      url: plan.url,
      ...(plan.sha256 === undefined ? {} : { sha256: plan.sha256 }),
      ...(entry.headers === undefined
        ? {}
        : { headers: { ...withoutRoutingHeaders(entry.headers) } }),
      ...(entry.headersHelper?.trim() ? { headersHelper: entry.headersHelper } : {}),
    },
  }),
  command: (_plan, entry) => {
    throw new Error(
      `Entry "${entry.name}" uses a "command" source, which Localix does not run; install the plugin from the directory that command prints`,
    )
  },
}

const resolvePlan = <K extends FetchPlan['kind']>(
  plan: Plan<K>,
  entry: MarketplaceEntry,
  dir: string,
): ResolvedEntrySource => (RESOLVE[plan.kind] as Resolve<K>)(plan, entry, dir)

/** Resolve `entry` of the marketplace rooted in `dir`, added from `origin`, or throw why not. */
export function resolveEntrySource(
  dir: string,
  entry: MarketplaceEntry,
  origin?: MarketplaceSource,
): ResolvedEntrySource {
  const { plan, issues } = planPluginFetch(entry.source, {
    platform: process.platform === 'win32' ? 'windows' : 'posix',
    ...(origin === undefined ? {} : { marketplaceOrigin: origin }),
  })
  if (!plan)
    throw new Error(
      `Entry "${entry.name}" source: ${issues.map(issueLine).join('; ') || 'refused'}`,
    )
  return resolvePlan(plan, entry, dir)
}
