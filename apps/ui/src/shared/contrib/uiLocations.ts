import type {
  ResolvedUiLocation,
  UiAgentLocationCatalogSnapshot,
  UiLocationContribution,
  UiLocationDescriptor,
  UiLocationExposure,
  UiLocationParamSchema,
} from '@localixai/plugin-sdk/ui'
import {
  buildUiLocationUri as buildSerializedUiLocationUri,
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
import { checkContribution } from './uiLocationValidation'
import { rankUiLocations } from './uiLocationSearch'
import {
  locationDescriptor,
  storeLocationContribution,
  uiLocationIconId,
  type ErasedLocation,
} from './uiLocationRecord'

export { uiLocationIconId } from './uiLocationRecord'

export { parseUiLocationArgs }

export interface UiLocationAccess {
  /** Write intents are reserved for explicitly trusted, user-driven callers. */
  allowWrite?: boolean
}

export type UiLocationAudience = keyof UiLocationExposure | 'agent'

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
      const stored = storeLocationContribution(contribution, id, uri, schema)
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
          descriptor: locationDescriptor(entry),
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
        entries.push(locationDescriptor(entry))
      }
      return entries
    },
    search(query, options) {
      const needle = query.trim().toLowerCase()
      const limit = Math.max(1, Math.min(options?.limit ?? 8, 20))
      return rankUiLocations(this.list({ exposure: options?.exposure }), needle, limit)
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
