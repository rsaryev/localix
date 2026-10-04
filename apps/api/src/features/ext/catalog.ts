/**
 * Generic catalog-fusion primitive used by the plugins subsystem
 * (`features/plugins/catalog.ts`).
 *
 * Both leaves follow an identical pattern:
 *   1. Discover items from the filesystem (project-scoped + global).
 *   2. Load DB state rows (config + provenance) keyed by `${projectId}:${name}`.
 *   3. Join each discovered item to its state row (or `undefined`).
 *   4. Decide availability: the agent's rules, judged against the item's trust class.
 *   5. Expose `.all`, `.enabled`, `.find(name, projectId)`.
 *
 * Step 4 is ONE decision. The item's trust class — bundled, opt-in, untrusted — is a fact
 * about the artifact, and it travels into the rule lookup as the resource, so a rule can name
 * it (`plugin:* untrusted ask`) and a rule about the item itself answers over it. What the
 * class still decides alone is what SILENCE means, because that is the one default that
 * varies by artifact rather than by kind.
 *
 * This module implements the pattern once and lets each leaf supply its own concrete
 * `TItem` / `TState` types and trust classifier. It has NO imports from `chat`, `ui`, or any
 * feature-specific code.
 */
import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilityKind } from '../capabilities/resolve'
import type { TrustClass } from './trust'

/**
 * Minimal shape that every discoverable item must satisfy so the catalog can
 * derive the scope key and locate the item in `.find`.
 */
export interface ExtCatalogItem {
  /** Scope identifier: `''` for global, non-empty string for project-scoped. */
  projectId: string
  manifest: { name: string }
}

/**
 * Minimal shape that every DB-state row must satisfy.
 *
 * Nothing, now. A state row holds config and provenance; whether the item may RUN is a
 * capability verdict composed across global / project / agent, and a boolean sitting in
 * one project's row could never answer for the agent about to use it.
 */
export type ExtStateRecord = object

/**
 * One discovered item paired with its DB state (or `undefined` when no row
 * exists yet) and the resolved enable verdict.
 */
export interface CatalogEntry<TItem extends ExtCatalogItem, TState extends ExtStateRecord> {
  item: TItem
  state: TState | undefined
  /** May it run — the rules' answer, with the item's trust class deciding silence. */
  enabled: boolean
  /**
   * True when it is not running only because nobody has said yes yet.
   *
   * Distinct from plain `!enabled`, which also covers a denial. A caller that can put the
   * question to a person needs to tell the two apart; one that cannot treats both as off.
   */
  awaitingConsent: boolean
}

/**
 * The ready-to-consume catalog returned by `buildExtCatalog`.
 */
export interface ExtCatalog<TItem extends ExtCatalogItem, TState extends ExtStateRecord> {
  /** Every item visible to the scope, in discovery order. */
  all: CatalogEntry<TItem, TState>[]
  /** Only the entries whose item is enabled. */
  enabled: CatalogEntry<TItem, TState>[]
  /** Find one entry by (name, projectId). */
  find(name: string, projectId: string): CatalogEntry<TItem, TState> | undefined
}

/**
 * Build the fused catalog from pre-loaded data.
 *
 * The caller is responsible for fetching `discovered` items and building the
 * `stateByKey` map (keyed by `${state.projectId}:${state.name}` — the scope
 * key that separates project vs global rows for the same extension name).
 *
 * @param discovered       Items in discovery/precedence order (duplicates already
 *                         removed by the caller's scanner).
 * @param stateByKey       Map from `${projectId}:${name}` → state row. Pass an empty map
 *                         when no state has been loaded.
 * @param kind             The capability kind these items are addressed as.
 * @param availability     What the rules say — including "nothing".
 * @param defaultEnabled   The leaf's trust gate, consulted only when no rule says.
 */
export function buildExtCatalog<TItem extends ExtCatalogItem, TState extends ExtStateRecord>(opts: {
  discovered: TItem[]
  stateByKey: Map<string, TState>
  kind: CapabilityKind
  availability: AvailabilityReader
  trustOf: (item: TItem) => TrustClass
}): ExtCatalog<TItem, TState> {
  const { discovered, stateByKey, kind, availability, trustOf } = opts

  const all: CatalogEntry<TItem, TState>[] = discovered.map((item) => {
    const state = stateByKey.get(`${item.projectId}:${item.manifest.name}`)
    const effect = availability.effectFor(kind, item.manifest.name, trustOf(item))
    return {
      item,
      state,
      enabled: effect === 'allow',
      awaitingConsent: effect === 'ask',
    }
  })

  return {
    all,
    enabled: all.filter((e) => e.enabled),
    find: (name, projectId) =>
      all.find((e) => e.item.manifest.name === name && e.item.projectId === projectId),
  }
}

/**
 * Higher-level scoped catalog builder: runs discovery + state load in parallel,
 * builds the scope-keyed state map, applies the enable rule via `buildExtCatalog`,
 * then maps each generic `CatalogEntry` to the leaf's domain entry shape (the
 * `item` → `plugin`/`provider` field rename). This is the fusion GLUE both the
 * plugins leaf (`features/plugins/catalog.ts`) used to copy verbatim — kept here
 * so a second discoverable kind cannot drift on the discover→state→enable→map dance, while each
 * leaf keeps its own concrete types + public `{all, enabled, find}` catalog shape.
 */
export async function buildScopedExtCatalog<
  TItem extends ExtCatalogItem,
  TState extends ExtStateRecord & { projectId: string; name: string },
  TEntry extends { enabled: boolean },
>(opts: {
  userId: string
  projectId: string
  cwd: string | null
  discover: (scope: { cwd: string | null; projectId: string }) => Promise<TItem[]>
  listForScope: (userId: string, projectId: string) => Promise<TState[]>
  kind: CapabilityKind
  availability: AvailabilityReader
  trustOf: (item: TItem) => TrustClass
  toEntry: (entry: CatalogEntry<TItem, TState>) => TEntry
}): Promise<{
  all: TEntry[]
  enabled: TEntry[]
  find(name: string, projectId: string): TEntry | undefined
}> {
  const [discovered, states] = await Promise.all([
    opts.discover({ cwd: opts.cwd, projectId: opts.projectId }),
    opts.listForScope(opts.userId, opts.projectId),
  ])
  // Key includes scope so a project extension and a global one of the same name keep
  // separate config rows.
  const stateByKey = new Map(states.map((s) => [`${s.projectId}:${s.name}`, s]))
  const inner = buildExtCatalog({
    discovered,
    stateByKey,
    kind: opts.kind,
    availability: opts.availability,
    trustOf: opts.trustOf,
  })

  const all = inner.all.map(opts.toEntry)
  return {
    all,
    enabled: all.filter((e) => e.enabled),
    find: (name, projectId) => {
      const e = inner.find(name, projectId)
      return e ? opts.toEntry(e) : undefined
    },
  }
}
