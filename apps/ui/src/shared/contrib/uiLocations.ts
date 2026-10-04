import type {
  ResolvedUiLocation,
  UiAnchorOpenResult,
  UiAgentLocationCatalogSnapshot,
  UiLocationContribution,
  UiLocationDescriptor,
  UiLocationExposure,
  UiLocationParamSchema,
  UiLocationPresentation,
} from '@localixai/plugin-sdk/ui'
import {
  buildUiLocationUri as buildSerializedUiLocationUri,
  isValidUiLocationAgentMetadata,
  isValidUiLocationParamSchema,
  isValidUiMutationBaseUri,
  normalizeUiLocationBaseUri,
  parseUiLocationArgs,
  UI_AGENT_LOCATION_CATALOG_VERSION,
} from '@localixai/plugin-sdk/ui'
import {
  localixUiUri,
  parseLocalixUri,
  type LocalixUiPrimitive,
} from '@localixai/plugin-sdk/navigation'
import { isPluginContributionEnabled, subscribePluginActivation } from './pluginActivation'
import { registerResourceRefIcons } from './iconContributions'

const UI_SURFACE_KINDS = new Set([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'plugin',
  'command',
  'action',
])

type NormalizedArgs = Record<string, string | string[] | boolean | number>
type ErasedLocation = Omit<UiLocationContribution, 'present' | 'resolve'> & {
  source: object
  present?(args: NormalizedArgs): UiLocationPresentation
  resolve(args: NormalizedArgs): UiAnchorOpenResult | null
}

export { parseUiLocationArgs }

export interface UiLocationAccess {
  /** Write intents are reserved for explicitly trusted, user-driven callers. */
  allowWrite?: boolean
}

export type UiLocationAudience = keyof UiLocationExposure | 'agent'

export function uiLocationIconId(id: string): string {
  return `ui-location:${id}`
}

/**
 * Build a registry id from plugin-supplied identity that is valid by construction.
 *
 * A location id must match `/^[a-z0-9][a-z0-9:._-]{0,127}$/`, but a plugin's view or
 * panel name is declared as a bare string and camelCase is ordinary in JS. Synthesizing
 * `plugin-view.open.${fullName}` from `example:sqlConsole` therefore produced an invalid
 * id — and since views and panels register as ONE atomic batch, that single rejection
 * withdrew EVERY plugin destination from the catalog and from the agent's synchronized
 * copy of it.
 *
 * The id is our own registry key, not the plugin's identity: the addressable identity is
 * the URI, which percent-encodes `fullName` and is unaffected. So the host normalizes the
 * key rather than requiring manifests to be lowercase. Two names that normalize alike
 * collide, which the registry already reports and which costs one destination instead of
 * all of them.
 */
export function pluginLocationId(prefix: string, fullName: string): string {
  const normalized = fullName
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}.${normalized || 'unnamed'}`.slice(0, 128)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function compareLocationOrder(left: UiLocationDescriptor, right: UiLocationDescriptor): number {
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0
}

function validExposure(exposure: UiLocationExposure | undefined): exposure is UiLocationExposure {
  if (!exposure) return false
  const entries = Object.entries(exposure)
  return (
    entries.every(
      ([key, value]) => (key === 'search' || key === 'palette') && typeof value === 'boolean',
    ) && entries.length <= 2
  )
}

function parseRegisteredUri(
  value: string,
): { baseUri: string; searchParams: URLSearchParams } | null {
  const parsed = parseLocalixUri(value)
  if (parsed?.primitive !== 'ui') return null
  const [surface, ...segments] = parsed.breadcrumbs
  return {
    baseUri: localixUiUri(surface as LocalixUiPrimitive, segments),
    searchParams: parsed.query,
  }
}

/**
 * Admit a contribution, or name the single rule it violates.
 *
 * Rejection used to be a bare `false`. For a statically discovered `*.surface.ts` that
 * still failed startup — but with the generic "invalid or colliding metadata", which does
 * not say which of thirteen rules was broken. For a plugin or runtime view it failed
 * SILENTLY: the destination simply never existed, and because runtime views register as
 * one atomic batch, a single malformed entry rolled back every plugin destination and then
 * propagated that absence to the agent's synchronized catalog.
 *
 * The conditions and their order are unchanged. Returning the normalized uri and the
 * guarded schema keeps the narrowings the old inline condition gave `register` for free.
 */
type ContributionCheck =
  | { ok: true; uri: string; schema: UiLocationParamSchema }
  | { ok: false; reason: string }

function checkContribution(
  contribution: UiLocationContribution<UiLocationParamSchema>,
): ContributionCheck {
  const id = contribution.id.trim()
  const uri = normalizeUiLocationBaseUri(contribution.uri, contribution.surface)
  const schema = contribution.params ?? {}
  const no = (reason: string): ContributionCheck => ({ ok: false, reason })
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/.test(id))
    return no('id must be lowercase, dotted, ≤128 chars')
  if (!uri)
    return no(`uri "${contribution.uri}" is not a canonical ${contribution.surface} base URI`)
  if (!contribution.title.trim()) return no('title is empty')
  if (contribution.title.length > 120) return no('title exceeds 120 chars')
  if ((contribution.description?.length ?? 0) > 240) return no('description exceeds 240 chars')
  if ((contribution.keywords?.length ?? 0) > 16) return no('more than 16 keywords')
  if (contribution.keywords?.some((keyword) => !keyword || keyword.length > 64)) {
    return no('a keyword is empty or exceeds 64 chars')
  }
  if (contribution.effect !== 'read' && contribution.effect !== 'write') {
    return no(`effect must be "read" or "write", got ${JSON.stringify(contribution.effect)}`)
  }
  if (!UI_SURFACE_KINDS.has(contribution.surface)) {
    return no(`unknown surface ${JSON.stringify(contribution.surface)}`)
  }
  if ((contribution.effect === 'write') !== (contribution.surface === 'action')) {
    return no('effect "write" and surface "action" are one decision — both or neither')
  }
  if (contribution.effect === 'write' && !isValidUiMutationBaseUri(uri)) {
    return no('a write intent needs a localix://ui/action/<owner>/<name> URI')
  }
  if (!validExposure(contribution.exposure))
    return no('exposure must be { search?, palette? } booleans')
  if (contribution.agent !== undefined && !isValidUiLocationAgentMetadata(contribution.agent)) {
    return no('agent metadata must be { description, availability? }')
  }
  if (contribution.effect === 'write' && contribution.agent !== undefined) {
    return no('a write intent must never be agent-exposed')
  }
  if (contribution.effect === 'write' && !hasOwn(contribution, 'params')) {
    return no('a write intent must declare params explicitly, even when empty')
  }
  if (!isValidUiLocationParamSchema(schema)) return no('params schema is invalid')
  if (
    contribution.agent !== undefined &&
    Object.values(schema).some((definition) => !definition.description)
  ) {
    return no('every param of an agent-exposed destination needs a description')
  }
  return { ok: true, uri, schema }
}

export interface UiLocationRegistry {
  register<const TParams extends UiLocationParamSchema>(
    contribution: UiLocationContribution<TParams>,
  ): boolean
  unregister(id: string): boolean
  /** Drop every destination `owner` registered, with one catalog notification. */
  removeOwner(owner: string): void
  owns(uri: string): boolean
  resolve(uri: string, access?: UiLocationAccess): ResolvedUiLocation | null
  build(id: string, args?: Record<string, unknown>, access?: UiLocationAccess): string | null
  list(options?: { exposure?: UiLocationAudience }): UiLocationDescriptor[]
  search(
    query: string,
    options?: { exposure?: UiLocationAudience; limit?: number },
  ): UiLocationDescriptor[]
  revision(): number
  batch(update: () => boolean): boolean
  refresh(): void
  subscribe(listener: () => void): () => void
}

/** Process-local catalog rebuilt by `discoverUi()` on every frontend start. */
export function createUiLocationRegistry(): UiLocationRegistry {
  const byId = new Map<string, ErasedLocation>()
  const byUri = new Map<string, ErasedLocation>()
  const listeners = new Set<() => void>()
  let currentRevision = 0
  let batching = false
  let batchDirty = false

  const notify = () => {
    if (batching) {
      batchDirty = true
      return
    }
    currentRevision += 1
    listeners.forEach((listener) => listener())
  }

  const descriptor = (entry: ErasedLocation): UiLocationDescriptor => ({
    id: entry.id,
    uri: entry.uri,
    title: entry.title,
    ...(entry.description ? { description: entry.description } : {}),
    keywords: [...(entry.keywords ?? [])],
    ...(entry.group ? { group: entry.group } : {}),
    ...(entry.Icon ? { icon: uiLocationIconId(entry.id) } : {}),
    effect: entry.effect,
    surface: entry.surface,
    ...(entry.agent ? { agent: { ...entry.agent } } : {}),
    params: Object.fromEntries(
      Object.entries(entry.params ?? {}).map(([key, definition]) => [
        key,
        definition.type === 'string' && definition.values
          ? { ...definition, values: [...definition.values] }
          : { ...definition },
      ]),
    ),
    exposure: { ...entry.exposure },
  })

  return {
    register(contribution) {
      const id = contribution.id.trim()
      const checked = checkContribution(contribution)
      if (!checked.ok) {
        console.warn(`[ui-locations] rejected "${contribution.id}": ${checked.reason}`)
        return false
      }
      const { uri, schema } = checked
      const existingById = byId.get(id)
      const existingByUri = byUri.get(uri)
      if (existingById?.source === contribution && existingByUri?.source === contribution) {
        return true
      }
      if (existingById || existingByUri) {
        console.warn(
          existingById
            ? `[ui-locations] duplicate id "${id}" — keeping the first owner`
            : `[ui-locations] duplicate URI "${uri}" — keeping the first owner`,
        )
        return false
      }
      const normalizedParams = Object.freeze(
        Object.fromEntries(
          Object.entries(schema).map(([key, definition]) => [
            key,
            Object.freeze(
              definition.type === 'string' && definition.values
                ? { ...definition, values: Object.freeze([...definition.values]) }
                : { ...definition },
            ),
          ]),
        ),
      )
      const stored = Object.freeze({
        ...contribution,
        id,
        uri,
        title: contribution.title.trim(),
        keywords: contribution.keywords ? Object.freeze([...contribution.keywords]) : undefined,
        params: normalizedParams,
        exposure: Object.freeze({ ...contribution.exposure }),
        agent: contribution.agent ? Object.freeze({ ...contribution.agent }) : undefined,
        source: contribution,
      }) as unknown as ErasedLocation
      byId.set(id, stored)
      byUri.set(uri, stored)
      if (stored.Icon) {
        registerResourceRefIcons({ [uiLocationIconId(id)]: stored.Icon }, stored.pluginName)
      }
      notify()
      return true
    },
    unregister(id) {
      const entry = byId.get(id)
      if (!entry) return false
      byId.delete(id)
      byUri.delete(entry.uri)
      notify()
      return true
    },
    removeOwner(owner) {
      let removed = false
      for (const [id, entry] of byId) {
        if (entry.pluginName !== owner) continue
        byId.delete(id)
        byUri.delete(entry.uri)
        removed = true
      }
      if (removed) notify()
    },
    owns(uri) {
      const parsed = parseRegisteredUri(uri)
      return parsed ? byUri.has(parsed.baseUri) : false
    },
    resolve(uri, access) {
      const parsed = parseRegisteredUri(uri)
      if (!parsed) return null
      const entry = byUri.get(parsed.baseUri)
      if (!entry || !isPluginContributionEnabled(entry.pluginName)) return null
      if (entry.effect === 'write' && !access?.allowWrite) return null
      const args = parseUiLocationArgs(entry.params ?? {}, parsed.searchParams)
      if (!args) return null
      try {
        const target = entry.resolve(args)
        if (!target) return null
        const proposedPresentation = entry.present?.(args)
        const presentation =
          proposedPresentation?.label.trim() &&
          proposedPresentation.label.length <= 120 &&
          (proposedPresentation.description?.length ?? 0) <= 240
            ? proposedPresentation
            : {
                label: entry.title,
                ...(entry.description ? { description: entry.description } : {}),
              }
        return {
          descriptor: descriptor(entry),
          args,
          target,
          presentation,
        }
      } catch (error) {
        console.warn(`[ui-locations] resolver "${entry.id}" failed`, error)
        return null
      }
    },
    build(id, args = {}, access) {
      const entry = byId.get(id)
      if (!entry || !isPluginContributionEnabled(entry.pluginName)) return null
      if (entry.effect === 'write' && !access?.allowWrite) return null
      const uri = buildSerializedUiLocationUri(
        { uri: entry.uri, surface: entry.surface, params: entry.params ?? {} },
        args,
      )
      if (!uri) return null
      return this.resolve(uri, access) ? uri : null
    },
    list(options) {
      const entries: UiLocationDescriptor[] = []
      for (const entry of byId.values()) {
        if (!isPluginContributionEnabled(entry.pluginName)) continue
        if (
          options?.exposure &&
          (options.exposure === 'agent'
            ? !(
                entry.effect === 'read' &&
                entry.agent !== undefined &&
                entry.agent.availability !== 'runtime'
              )
            : entry.exposure?.[options.exposure] !== true)
        ) {
          continue
        }
        entries.push(descriptor(entry))
      }
      return entries
    },
    search(query, options) {
      const needle = query.trim().toLowerCase()
      const limit = Math.max(1, Math.min(options?.limit ?? 8, 20))
      const rows = this.list({ exposure: options?.exposure }).map((entry) => {
        const text =
          `${entry.title} ${entry.description ?? ''} ${entry.id} ${entry.keywords.join(' ')}`.toLowerCase()
        const title = entry.title.toLowerCase()
        const score =
          !needle || title === needle
            ? 3
            : title.startsWith(needle)
              ? 2
              : text.includes(needle)
                ? 1
                : 0
        return { entry, score }
      })
      return rows
        .filter((row) => row.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || compareLocationOrder(left.entry, right.entry),
        )
        .slice(0, limit)
        .map((row) => row.entry)
    },
    revision: () => currentRevision,
    batch(update) {
      if (batching) return update()
      const previousById = new Map(byId)
      const previousByUri = new Map(byUri)
      const previousRevision = currentRevision
      batching = true
      batchDirty = false
      let accepted = false
      let threw = false
      try {
        accepted = update()
      } catch (error) {
        threw = true
        console.warn('[ui-locations] atomic catalog update failed', error)
      } finally {
        batching = false
      }
      // A batch that merely RETURNS false rolled back just as completely as one that
      // threw, and used to do it without a word. That silence is the expensive half: a
      // caller registering a group (plugin views, plugin panels) returns false as soon as
      // one member is rejected, so a single bad entry withdraws the whole group from the
      // catalog — and from the agent's synchronized copy of it.
      if (!accepted && !threw) {
        console.warn(
          '[ui-locations] atomic catalog update rejected — the whole batch was rolled back, ' +
            'so every destination it would have registered is absent (see the rejection above)',
        )
      }
      if (!accepted) {
        byId.clear()
        byUri.clear()
        for (const [id, entry] of previousById) byId.set(id, entry)
        for (const [uri, entry] of previousByUri) byUri.set(uri, entry)
        currentRevision = previousRevision
        batchDirty = false
        return false
      }
      if (batchDirty) notify()
      batchDirty = false
      return true
    },
    refresh: notify,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const registry = createUiLocationRegistry()

// Availability is part of the live snapshot even though definitions remain registered.
subscribePluginActivation(() => registry.refresh())

export const registerUiLocation = <const TParams extends UiLocationParamSchema>(
  contribution: UiLocationContribution<TParams>,
): boolean => registry.register(contribution)
export const unregisterUiLocation = (id: string): boolean => registry.unregister(id)
export const removeUiLocationsOf = (owner: string): void => registry.removeOwner(owner)
export const batchUiLocationChanges = (update: () => boolean): boolean => registry.batch(update)
export const isRegisteredUiLocationUri = (uri: string): boolean => registry.owns(uri)
export const resolveUiLocation = (
  uri: string,
  access?: UiLocationAccess,
): ResolvedUiLocation | null => registry.resolve(uri, access)
export const buildUiLocationUri = (
  id: string,
  args?: Record<string, unknown>,
  access?: UiLocationAccess,
): string | null => registry.build(id, args, access)
export const listUiLocations = (options?: {
  exposure?: UiLocationAudience
}): UiLocationDescriptor[] => registry.list(options)
export const searchUiLocations = (
  query: string,
  options?: { exposure?: UiLocationAudience; limit?: number },
): UiLocationDescriptor[] => registry.search(query, options)
export const uiLocationRevision = (): number => registry.revision()
export const uiAgentLocationCatalogSnapshot = (): UiAgentLocationCatalogSnapshot => ({
  version: UI_AGENT_LOCATION_CATALOG_VERSION,
  revision: registry.revision(),
  locations: registry.list({ exposure: 'agent' }).map((location) => ({
    uri: location.uri,
    title: location.title,
    description: location.agent!.description,
    aliases: location.keywords,
    ...(location.group ? { group: location.group } : {}),
    surface: location.surface as Exclude<typeof location.surface, 'action'>,
    params: location.params,
  })),
})
export const subscribeUiLocations = (listener: () => void): (() => void) =>
  registry.subscribe(listener)
