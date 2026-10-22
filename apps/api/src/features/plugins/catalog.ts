import { discoverPlugins, type DiscoveredPlugin } from './discovery'
import { pluginTrustClass } from './enable'
import { buildScopedExtCatalog } from '../ext/catalog'
import { hydrateSecretOptions } from './config-vault'
import type { AvailabilityReader } from '../capabilities/availability'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

/**
 * One discovered plugin paired with its stored config and the resolved verdict.
 * `enabled` is the whole answer: a rule in `capability_rule` decides, and where none mentions
 * the plugin its trust class does — bundled command-only plugins run, anything dropped in
 * waits to be asked about.
 */
export interface PluginCatalogEntry {
  plugin: DiscoveredPlugin
  state: CapabilitySourceRecord | undefined
  enabled: boolean
  /** Not running only because nobody has said yes yet — not because something said no. */
  awaitingConsent: boolean
}

export interface PluginCatalog {
  /** Every plugin visible to one exact project/no-project scope, in discovery order. */
  all: PluginCatalogEntry[]
  /** Only the entries whose plugin is enabled. */
  enabled: PluginCatalogEntry[]
  /**
   * Names of the plugins waiting on a decision — installed, not denied, not loaded.
   *
   * Derived here rather than at each caller because it is the same question `.enabled`
   * answers, asked the other way, and a second derivation is how the two would drift.
   */
  awaitingConsent: string[]
  /** Find one entry by (name, scope's projectId). */
  find(name: string, projectId: string): PluginCatalogEntry | undefined
}

/**
 * THE single place that fuses filesystem discovery + DB enable-state + the enable
 * rule into a ready-to-consume list. Every caller (settings list, commands list, chat
 * dispatch, runtime loader) builds a catalog instead of re-implementing the
 * discover → listForScope → stateByKey → isPluginEnabled dance, which is how the
 * loader/service once drifted apart on the default-enable rule.
 *
 * Delegates the fusion mechanics to the shared `buildExtCatalog` primitive in
 * `features/ext/catalog.ts`; public signature is unchanged.
 */
export async function buildPluginCatalog(opts: {
  repo: CapabilitySourceRepository
  /** What the scope's rules say. Absent = no rules, so every trust gate decides alone. */
  availability: AvailabilityReader
  userId: string
  projectId: string
  cwd: string | null
  /** The user's home (see `discoverPlugins`). */
  homeDir: string
}): Promise<PluginCatalog> {
  const inner = await buildScopedExtCatalog({
    userId: opts.userId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    discover: (scope) => discoverPlugins({ ...scope, homeDir: opts.homeDir }),
    // A sensitive option is a vault handle in the row; every consumer of a catalog gets its value.
    listForScope: async (userId, projectId) =>
      hydrateSecretOptions(userId, await opts.repo.listForScope(userId, projectId)),
    kind: 'plugin',
    availability: opts.availability,
    trustOf: pluginTrustClass,
    // Map the generic CatalogEntry shape to PluginCatalogEntry (field: `item` → `plugin`).
    toEntry: (e): PluginCatalogEntry => ({
      plugin: e.item,
      state: e.state,
      enabled: e.enabled,
      awaitingConsent: e.awaitingConsent,
    }),
  })
  return {
    ...inner,
    awaitingConsent: inner.all.flatMap((e) => (e.awaitingConsent ? [e.plugin.manifest.name] : [])),
  }
}
