import { buildResourceUri, parseResourceUri, resourceNav } from './resource-uri'
import type {
  ResourceBrowseResult,
  ResourceNode,
  ResourceNodeAction,
} from './resource-ref-contracts'

export const fold = (value: string): string => value.trim().toLocaleLowerCase()

export const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

export const compareNodes = (a: ResourceNode, b: ResourceNode): number =>
  compareText(a.label, b.label) ||
  compareText(a.detail ?? '', b.detail ?? '') ||
  compareText(a.uri, b.uri)

export const matchesBrowseQuery = (
  node: ResourceNode,
  query: string,
  provider: string,
  group: string,
): boolean => {
  if (!query) return true
  const identity = parseResourceUri(node.uri)?.rest ?? ''
  return fold(`${node.label}\n${node.detail ?? ''}\n${identity}\n${provider}\n${group}`).includes(
    query,
  )
}

/** Flatten groups for list-shaped clients while retaining the server-owned group label. */
export function flattenResourceBrowse(result: ResourceBrowseResult): ResourceNode[] {
  return result.groups.flatMap((group) =>
    group.resources.map((resource) => {
      // Provider section headers belong at root levels. A provider may still
      // explicitly group a drilled child level via the node's own `group`.
      const includeGroup =
        !resource.navigationOnly &&
        Boolean(resource.group || (result.parent === null && result.provider === null))
      return {
        ...resource,
        ...(includeGroup ? { group: resource.group ?? group.label } : {}),
      }
    }),
  )
}

/** Sugar for the single-link `actions` declaration every provider writes:
 *  a nicer verb for the container's "Link this …" row. */
export function linkAction(label: string): ResourceNodeAction[] {
  return [{ id: 'link', label, kind: 'link' }]
}

/**
 * A non-interactive NOTICE row for a listing that dropped items (a cap, a failed
 * read): the menu renders it as a plain hint — never linkable, never drillable —
 * so truncation is stated in-band instead of silently. `uri` is the PARENT's uri
 * (a notice needs a stable key, not an addressable target).
 */
export function noticeNode(parentUri: string, label: string, detail?: string): ResourceNode {
  return { uri: `${parentUri}#notice`, label, detail, hasChildren: false, notice: true }
}

/** The standard "Showing N of M — type to search" truncation notice. */
export function truncationNotice(
  parentUri: string,
  shown: number,
  total: number,
  what: string,
  query?: string,
): ResourceNode {
  return noticeNode(
    parentUri,
    `Showing ${shown} of ${total}${query ? ` matching "${query}"` : ''} ${what}`,
    'type to search the full list',
  )
}

/** Shared transport-failure row for client adapters. Provider failures already
 * arrive in `ResourceBrowseResult.notices`; this covers the route itself being
 * unreachable during backend restart/reconnect without pretending the level is
 * genuinely empty. */
export function resourceBrowseFailureNotice(partial: string): ResourceNode {
  const nav = resourceNav(partial.trim())
  const owner =
    nav.parent ??
    (nav.provider ? buildResourceUri(nav.provider) : buildResourceUri('system', ['browser']))
  return noticeNode(owner, 'Resource browser unavailable', 'Check the connection and try again')
}
