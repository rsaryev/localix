import { buildScopedExtCatalog } from '../ext/catalog'
import { trustClassOf } from '../ext/trust'
import type { AvailabilityReader } from '../capabilities/availability'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import { miniAppOptions } from './config-vault'
import { discoverMiniApps, type DiscoveredMiniApp } from './discovery'

/** One mini app with its stored settings and whether it may run in this scope. */
export interface MiniAppCatalogEntry {
  app: DiscoveredMiniApp
  state: CapabilitySourceRecord | undefined
  enabled: boolean
  /** Not running only because nobody has said yes yet — not because something said no. */
  awaitingConsent: boolean
}

export interface MiniAppCatalog {
  all: MiniAppCatalogEntry[]
  enabled: MiniAppCatalogEntry[]
  /** Names of the mini apps waiting on a decision: installed, not refused, not loaded. */
  awaitingConsent: string[]
  find(name: string, projectId: string): MiniAppCatalogEntry | undefined
}

/**
 * Whether a mini app may run, decided as for any capability: a `mini-app:<name>` rule, and where
 * none speaks, its trust class. One Localix ships is trusted; any other one that would import code
 * waits to be asked about.
 */
export function miniAppTrustClass(app: DiscoveredMiniApp) {
  return trustClassOf({
    isBundled: app.bundled,
    isCodeBearing: app.backendEntries.length > 0,
    defaultEnabled: app.bundled ? true : undefined,
  })
}

export async function buildMiniAppCatalog(opts: {
  /** The `mini-app` rows of `capability_source`. */
  repo: CapabilitySourceRepository
  availability: AvailabilityReader
  userId: string
  projectId: string
  cwd: string | null
  homeDir: string
}): Promise<MiniAppCatalog> {
  const inner = await buildScopedExtCatalog({
    userId: opts.userId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    discover: async (scope) =>
      (await discoverMiniApps({ ...scope, homeDir: opts.homeDir })).map((app) => ({
        app,
        projectId: app.projectId,
        scope: app.scope,
        manifest: { name: app.name },
      })),
    listForScope: async (userId, projectId) =>
      miniAppOptions.hydrateSecretOptions(userId, await opts.repo.listForScope(userId, projectId)),
    kind: 'mini-app',
    availability: opts.availability,
    trustOf: (item) => miniAppTrustClass(item.app),
    toEntry: (entry): MiniAppCatalogEntry => ({
      app: entry.item.app,
      state: entry.state,
      enabled: entry.enabled,
      awaitingConsent: entry.awaitingConsent,
    }),
  })
  return {
    ...inner,
    awaitingConsent: inner.all.flatMap((entry) => (entry.awaitingConsent ? [entry.app.name] : [])),
  }
}
