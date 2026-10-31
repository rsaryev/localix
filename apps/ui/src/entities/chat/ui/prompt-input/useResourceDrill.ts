/**
 * useResourceDrill — the shared resource/UI-anchor drill-down state machine, extracted
 * out of useAtRefAutocomplete (which had grown into a god file). It owns ONLY the
 * resource tree's data fetching + caching; the autocomplete hook consumes its
 * output to build the menu rows.
 *
 * Unified provider drill-down across arbitrary resource hierarchies. The backend
 * lists a node's children; the current
 * CONTAINER is derived from the typed partial (`resourceNav`). The backend owns
 * resource search/order/grouping; successful pages are cached only while the
 * picker remains open. `/open` may additionally prepend client-only UI anchors.
 *
 * Behavior is preserved verbatim from the inline version — this is a structural
 * split, not a change.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { ResourceNode } from '@/shared/api/contracts'
import { listUiAnchorChildren } from '@/shared/contrib/uiAnchors'
import {
  flattenResourceBrowse,
  resourceBrowseFailureNotice,
  resourceNav,
} from '@localixai/api/context-refs'
import { resourceBreadcrumbs, type ResourceBreadcrumb } from './openResourceNav'

/** A typed resource search waits this long for the next keystroke before it asks. */
const RESOURCE_SEARCH_DEBOUNCE_MS = 180
/** A failed browse asks again after this, while the picker is still open. */
const RESOURCE_RETRY_MS = 1_500

export interface ResourceDrill {
  /** The current level's children (or roots), in backend-owned browse order. */
  nodes: ResourceNode[]
  /** Backend-owned display-only rows; never mixed into selection/history. */
  notices: ResourceNode[]
  /** True while THIS level's children are being fetched (drives the spinner row). */
  pending: boolean
  /** The parent URI whose children are shown (null = provider roots). */
  parent: string | null
  /** The trailing segment the user is typing (filters children locally). */
  segment: string
  /** The container node drilled INTO (whose ACTIONS head the level), recovered
   *  from the cached grandparent listing. Cold cache → null. */
  container: ResourceNode | null
  breadcrumbs: ResourceBreadcrumb[]
}

export interface ResourceDrillInput {
  active: boolean
  partial: string
  sessionId?: string | null
  /** `/open` may additionally browse client-only navigation anchors. `@resource:`
   *  intentionally leaves this false so its contract remains backend-authoritative. */
  includeUiAnchors?: boolean
}

export function useResourceDrill(input: ResourceDrillInput): ResourceDrill {
  const resourceMode = input.active
  const resourceNavTarget = resourceMode ? resourceNav(input.partial) : null
  const resourceParent = resourceNavTarget?.parent ?? null
  const resourceSegment = resourceNavTarget?.segment ?? ''
  const resourceProvider = resourceNavTarget?.provider ?? null

  const [resourceNodes, setResourceNodes] = useState<ResourceNode[]>([])
  const [resourceNotices, setResourceNotices] = useState<ResourceNode[]>([])
  // True while the CURRENT level's children are being fetched — drives the
  // menu's spinner row (instead of vanishing or showing a stale level).
  const [resourcePending, setResourcePending] = useState(false)
  const [resourceRetry, setResourceRetry] = useState(0)
  const resourceCache = useRef(
    new Map<string, { nodes: ResourceNode[]; notices: ResourceNode[] }>(),
  )
  // Which PARENT the displayed `resourceNodes` belong to — lets a drill into a
  // different level clear the stale rows (they were still clickable) while a
  // same-level filter keystroke keeps them for local narrowing.
  const resourceShownParent = useRef<string | null>(null)
  // Every node we have ever seen, by URI. Used to recover the drilled-into CONTAINER without
  // guessing which cache page it came from (a page is now keyed by parent AND search).
  const [resourceNodeByUri, setResourceNodeByUri] = useState<Map<string, ResourceNode>>(
    () => new Map(),
  )

  // Provider trees are live (connections and mini app enablement can change). Do not carry a
  // successful or failed page across closing/reopening the picker. Resource visibility may also be
  // session-owned (for example, one resource set per chat), so a picker that stays open while the
  // active chat changes must not reuse the previous session's page. Both are a change of `scope`
  // (null while the picker is closed): reset while rendering, so no frame shows the old pages.
  const scope = resourceMode ? (input.sessionId ?? '@no-session') : null
  const [prevScope, setPrevScope] = useState(scope)
  if (prevScope !== scope) {
    setPrevScope(scope)
    setResourceNodes([])
    setResourceNotices([])
    setResourceNodeByUri(new Map())
    if (scope === null) {
      setResourcePending(false)
      setResourceRetry(0)
    }
  }
  // Declared before the fetch effect, so the cache is already empty when the new scope's fetch runs.
  useEffect(() => {
    resourceCache.current.clear()
    resourceShownParent.current = null
  }, [scope])

  useEffect(() => {
    if (!resourceMode) return
    // The typed segment goes to the SERVER as well as filtering locally: a provider that caps its
    // listing cannot otherwise surface what a provider-side cap dropped.
    const search = resourceSegment.trim()
    const scopeKey = input.sessionId ?? '@no-session'
    const parentKey = `${scopeKey}\0${resourceParent ?? `roots:${resourceProvider ?? '*'}`}`
    const cacheKey = `${parentKey}\0${search}`
    const cached = resourceCache.current.get(cacheKey)
    if (cached) {
      setResourceNodes(cached.nodes)
      setResourceNotices(cached.notices)
      resourceShownParent.current = parentKey
      setResourcePending(false)
      return
    }

    // Cache miss on a DIFFERENT level: the shown rows belong to the previous
    // parent — clear them (stale, but still clickable) and show the spinner.
    // A same-level miss (typing a filter) keeps the current page for local
    // narrowing while the server search is in flight.
    if (resourceShownParent.current !== parentKey) {
      setResourceNodes([])
    }
    // Notices describe one exact backend page (including its query/cap). Never
    // carry a stale "showing N of M" or failure below rows for the next query.
    setResourceNotices([])
    setResourcePending(true)

    let cancelled = false
    // Debounced: a keystroke must not be a request.
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(
      () => {
        void backendClient
          .browseResources(input.partial, input.sessionId ?? undefined)
          .then((result) => ({
            backendNodes: flattenResourceBrowse(result),
            notices: result.notices,
          }))
          .then(({ backendNodes, notices }) => {
            if (cancelled) return
            const clientNodes = input.includeUiAnchors
              ? listUiAnchorChildren(resourceParent, search || undefined)
              : []
            // `@resource:` preserves the backend's exact ordering. `/open` is the
            // explicit exception: local UI-only anchors are prepended because they
            // cannot exist on the server and are not model-facing resources.
            const nodes = input.includeUiAnchors
              ? Array.from(
                  new Map(
                    [...clientNodes, ...backendNodes].map((node) => [node.uri, node]),
                  ).values(),
                )
              : backendNodes
            resourceCache.current.set(cacheKey, { nodes, notices })
            setResourceNodeByUri((previous) => {
              const next = new Map(previous)
              for (const node of nodes) next.set(node.uri, node)
              return next
            })
            setResourceNodes(nodes)
            setResourceNotices(notices)
            resourceShownParent.current = parentKey
            setResourcePending(false)
          })
          .catch(() => {
            if (cancelled) return
            // A route/network failure is not an empty resource tree. Surface the
            // shared non-selectable notice (`resourceBrowseFailureNotice`) and retry
            // while the picker is still open, so a backend reconnect heals without
            // another keystroke.
            setResourceNodes([])
            setResourceNotices([resourceBrowseFailureNotice(input.partial)])
            resourceShownParent.current = parentKey
            setResourcePending(false)
            retryTimer = setTimeout(() => setResourceRetry((value) => value + 1), RESOURCE_RETRY_MS)
          })
      },
      search ? RESOURCE_SEARCH_DEBOUNCE_MS : 0,
    )

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [
    resourceMode,
    resourceParent,
    resourceProvider,
    resourceSegment,
    resourceRetry,
    input.partial,
    input.sessionId,
    input.includeUiAnchors,
  ])

  // The container node the user has drilled INTO (whose ACTIONS head the level).
  // Derived from the cached GRANDPARENT listing (where this node appeared as a
  // child), so it carries the provider-declared `actions`. Cold cache (a hand-typed
  // URI) → null, and the default "Link this here" still applies.
  const resourceContainer = useMemo(() => {
    if (!resourceParent) return null
    return resourceNodeByUri.get(resourceParent) ?? null
  }, [resourceParent, resourceNodeByUri])

  return {
    nodes: resourceNodes,
    notices: resourceNotices,
    pending: resourcePending,
    parent: resourceParent,
    segment: resourceSegment,
    container: resourceContainer,
    breadcrumbs: resourceBreadcrumbs(resourceParent, resourceNodeByUri),
  }
}
