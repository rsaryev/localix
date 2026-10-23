import {
  localixUriNamespace,
  type UiAnchorContribution,
  type UiAnchorNode,
  type UiAnchorOpenResult,
} from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled } from './miniAppActivation'

export interface UiAnchorRegistry {
  register(contribution: UiAnchorContribution): boolean
  resolve(uri: string): UiAnchorOpenResult | null
  listChildren(parentUri: string | null, query?: string): UiAnchorNode[]
  owner(namespace: string): UiAnchorContribution | undefined
  /** Drop every anchor `owner` registered, releasing its namespaces. */
  removeOwner(owner: string): void
}

/**
 * Namespace-owned registry: one contribution exclusively owns each Localix URI namespace.
 * Registration is atomic — any id/namespace collision rejects the whole contribution.
 */
export function createUiAnchorRegistry(): UiAnchorRegistry {
  const byId = new Map<string, UiAnchorContribution>()
  const byNamespace = new Map<string, UiAnchorContribution>()

  return {
    register(contribution) {
      if (!contribution.id.trim() || contribution.namespaces.length === 0) return false
      if (byId.get(contribution.id) === contribution) return true
      if (byId.has(contribution.id)) {
        console.warn(`[ui-anchors] duplicate contribution id "${contribution.id}"`)
        return false
      }
      const namespaces = Array.from(
        new Set(contribution.namespaces.map((namespace) => namespace.toLowerCase())),
      )
      if (
        namespaces.some(
          (namespace) => localixUriNamespace(`localix://resource/${namespace}`) !== namespace,
        )
      ) {
        return false
      }
      const collision = namespaces.find((namespace) => byNamespace.has(namespace))
      if (collision) {
        console.warn(`[ui-anchors] namespace "${collision}" already has an owner`)
        return false
      }
      byId.set(contribution.id, contribution)
      for (const namespace of namespaces) byNamespace.set(namespace, contribution)
      return true
    },
    resolve(uri) {
      const namespace = localixUriNamespace(uri)
      const contribution = namespace ? byNamespace.get(namespace) : undefined
      return contribution && isMiniAppContributionEnabled(contribution.pluginName)
        ? contribution.resolve(uri)
        : null
    },
    listChildren(parentUri, query) {
      const contributions = parentUri
        ? [byNamespace.get(localixUriNamespace(parentUri) ?? '')].filter(
            (entry): entry is UiAnchorContribution => entry !== undefined,
          )
        : Array.from(byId.values())
      const rows = contributions.flatMap((contribution) =>
        isMiniAppContributionEnabled(contribution.pluginName)
          ? (contribution.listChildren?.(parentUri, query) ?? [])
          : [],
      )
      const needle = query?.trim().toLocaleLowerCase()
      return needle
        ? rows.filter((row) =>
            `${row.label} ${row.detail ?? ''}`.toLocaleLowerCase().includes(needle),
          )
        : rows
    },
    owner(namespace) {
      const contribution = byNamespace.get(namespace.toLowerCase())
      return contribution && isMiniAppContributionEnabled(contribution.pluginName)
        ? contribution
        : undefined
    },
    removeOwner(owner) {
      for (const [id, entry] of byId) if (entry.pluginName === owner) byId.delete(id)
      for (const [ns, entry] of byNamespace) if (entry.pluginName === owner) byNamespace.delete(ns)
    },
  }
}

const registry = createUiAnchorRegistry()

export const registerUiAnchor = (contribution: UiAnchorContribution): boolean =>
  registry.register(contribution)
export const removeUiAnchorsOf = (owner: string): void => registry.removeOwner(owner)
export const resolveUiAnchor = (uri: string): UiAnchorOpenResult | null => registry.resolve(uri)
export const listUiAnchorChildren = (parentUri: string | null, query?: string): UiAnchorNode[] =>
  registry.listChildren(parentUri, query)

export type { UiAnchorContribution, UiAnchorNode, UiAnchorOpenResult }
