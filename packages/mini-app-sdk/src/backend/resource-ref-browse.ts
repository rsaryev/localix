import { buildResourceUri, parseResourceUri, resourceNav } from './resource-uri'
import type {
  ResourceBrowseGroup,
  ResourceNode,
  ResourceProviderRegistry,
  ResourceRefProvider,
  ResourceRefScope,
} from './resource-ref-contracts'
import {
  normalizeProviderNodes,
  providerTitle,
  RESOURCE_BROWSE_LIMIT,
} from './resource-ref-normalize'
import {
  compareNodes,
  compareText,
  fold,
  matchesBrowseQuery,
  noticeNode,
} from './resource-ref-presentation'

interface ResourceBrowserOptions {
  byProvider: ReadonlyMap<string, ResourceRefProvider>
  listProviderChildren: (
    provider: ResourceRefProvider,
    userId: string,
    parentUri: string | null,
    query?: string,
    scope?: ResourceRefScope,
  ) => Promise<unknown>
  maxNodesPerProvider: number
  warnListFailure: (provider: string, error: unknown) => ResourceNode[]
}

/** Backend-owned navigation, grouping, search, and response caps for resource pickers. */
export function createResourceBrowser({
  byProvider,
  listProviderChildren,
  maxNodesPerProvider,
  warnListFailure,
}: ResourceBrowserOptions): ResourceProviderRegistry['browse'] {
  const providerFailureNotice = (provider: ResourceRefProvider): ResourceNode =>
    noticeNode(
      buildResourceUri(provider.provider),
      `${providerTitle(provider)} unavailable`,
      'Could not load this resource group',
    )

  return async function browse(userId, partial, scope) {
    const normalizedPartial = partial.trim()
    const { parent, segment, provider: providerScope } = resourceNav(normalizedPartial)
    const query = fold(segment)
    const notices: ResourceNode[] = []
    const collected: Array<{
      provider: string
      group: string
      node: ResourceNode
    }> = []
    /** A provider's notice goes aside; a row is kept when it matches the typed segment. */
    const take = (provider: ResourceRefProvider, nodes: readonly ResourceNode[]) => {
      for (const node of nodes) {
        if (node.notice) {
          notices.push(node)
          continue
        }
        const group = node.group || providerTitle(provider)
        if (matchesBrowseQuery(node, query, provider.provider, group)) {
          collected.push({ provider: provider.provider, group, node })
        }
      }
    }

    // The global root is a lightweight category index. It does not eagerly list
    // every provider (or mix all of their roots into one long menu); selecting a
    // category scopes the next request to `localix://resource/<provider>`.
    if (parent === null && providerScope === null) {
      const categories = [...byProvider.values()]
        .filter(
          (provider) =>
            !query || fold(`${providerTitle(provider)}\n${provider.provider}`).includes(query),
        )
        .sort(
          (a, b) =>
            compareText(providerTitle(a), providerTitle(b)) || compareText(a.provider, b.provider),
        )
      const total = categories.length
      const kept = categories.slice(0, RESOURCE_BROWSE_LIMIT)
      if (total > kept.length) {
        notices.push(
          noticeNode(
            buildResourceUri('system', ['groups']),
            `Showing ${kept.length} of ${total} matching resource groups`,
            'type to search the full list',
          ),
        )
      }
      return {
        version: 1,
        partial: normalizedPartial,
        parent,
        provider: providerScope,
        segment,
        groups: kept.map((provider) => ({
          id: `category:${provider.provider}`,
          provider: provider.provider,
          label: providerTitle(provider),
          resources: [
            {
              uri: buildResourceUri(provider.provider),
              label: providerTitle(provider),
              hasChildren: true,
              icon: provider.provider,
              navigationOnly: true,
            },
          ],
        })),
        notices,
        total,
        truncated: total > kept.length,
      }
    }

    if (parent === null) {
      const providers = [...byProvider.values()].filter(
        (provider) => providerScope === null || provider.provider === providerScope,
      )
      const listings = await Promise.all(
        providers.map(async (provider) => {
          // Once a provider root is selected, the segment is a RESOURCE search. The
          // category itself was already selected, so matching the provider title
          // must not turn `localix://resource/catalog/catalog` into an unfiltered root listing.
          const providerQuery = segment.trim() || undefined
          try {
            const nodes = normalizeProviderNodes(
              provider,
              await listProviderChildren(provider, userId, null, providerQuery, scope),
              maxNodesPerProvider,
            )
            return { provider, nodes, failed: false }
          } catch (err) {
            warnListFailure(provider.provider, err)
            return { provider, nodes: [], failed: true }
          }
        }),
      )
      for (const { provider, nodes, failed } of listings) {
        if (failed) notices.push(providerFailureNotice(provider))
        take(provider, nodes)
      }
    } else {
      const parsed = parseResourceUri(parent)
      const provider = parsed ? byProvider.get(parsed.provider) : undefined
      if (provider) {
        let nodes: ResourceNode[] = []
        try {
          nodes = normalizeProviderNodes(
            provider,
            await listProviderChildren(
              provider,
              userId,
              parent,
              segment.trim() || undefined,
              scope,
            ),
            maxNodesPerProvider,
          )
        } catch (err) {
          warnListFailure(provider.provider, err)
          notices.push(providerFailureNotice(provider))
        }
        take(provider, nodes)
      }
    }

    const ordered = collected.sort(
      (a, b) =>
        compareText(a.group, b.group) ||
        compareText(a.provider, b.provider) ||
        compareNodes(a.node, b.node),
    )
    const seenUris = new Set<string>()
    const unique = ordered.filter(({ node }) => {
      if (seenUris.has(node.uri)) return false
      seenUris.add(node.uri)
      return true
    })
    const total = unique.length
    const kept = unique.slice(0, RESOURCE_BROWSE_LIMIT)
    if (total > kept.length) {
      notices.push(
        noticeNode(
          parent ?? buildResourceUri(providerScope ?? 'system', providerScope ? [] : ['resources']),
          `Showing ${kept.length} of ${total} matching resources`,
          'type to search the full list',
        ),
      )
    }
    const grouped = new Map<string, ResourceBrowseGroup>()
    for (const entry of kept) {
      const id = `${entry.provider}:${fold(entry.group)}`
      const group = grouped.get(id) ?? {
        id,
        provider: entry.provider,
        label: entry.group,
        resources: [],
      }
      group.resources.push(entry.node)
      grouped.set(id, group)
    }

    return {
      version: 1,
      partial: normalizedPartial,
      parent,
      provider: providerScope,
      segment,
      groups: [...grouped.values()],
      notices: notices.sort(compareNodes),
      total,
      truncated: total > kept.length,
    }
  }
}
