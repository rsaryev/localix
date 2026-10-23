import type { ResourceNode } from '@/shared/api/contracts'
import { localixUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

export interface ResourceBreadcrumb {
  uri: string | null
  label: string
}

/** Build clickable cumulative breadcrumbs for a canonical Localix URI. */
export function resourceBreadcrumbs(
  parent: string | null,
  known: ReadonlyMap<string, ResourceNode> = new Map(),
): ResourceBreadcrumb[] {
  const crumbs: ResourceBreadcrumb[] = [{ uri: null, label: 'Resources' }]
  if (!parent) return crumbs
  const parsed = parseLocalixUri(parent)
  if (!parsed) return crumbs
  const firstIdentityIndex = parsed.primitive === 'ui' ? 1 : 0
  for (let index = firstIdentityIndex; index < parsed.breadcrumbs.length; index++) {
    const uri = localixUri(parsed.primitive, parsed.breadcrumbs.slice(0, index + 1))
    crumbs.push({
      uri,
      label: known.get(uri)?.label ?? parsed.breadcrumbs[index]!,
    })
  }
  return crumbs
}
