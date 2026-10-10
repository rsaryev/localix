/**
 * useActiveTabRefs — the reactive face of `activeTabLinks`: subscribe to the grid store and yield the
 * current auto-link candidates (up to {@link AUTO_LINK_LIMIT}). Identity is stabilized on a joined
 * `tabId\0token\0label` signature so consumers only re-derive when the LINKS actually change (a tab
 * switch, an open, a retitle), not on every unrelated grid mutation.
 *
 * `useActiveTabRef` stays as the single-link façade for callers that want one.
 */
import { useSyncExternalStore } from 'react'
import { useGridStore } from './store'
import { activeTabLinks, type ActiveTabLink } from './activeTabLink'
import {
  liveTabMessageContextRevision,
  subscribeLiveTabMessageContext,
} from './liveTabMessageContext'

function linksSignature(links: readonly ActiveTabLink[]): string {
  return JSON.stringify(links)
}

export function useActiveTabRefs(): ActiveTabLink[] {
  // Grid mutations and live component publications are independent stores. The
  // first signature wakes us for tab/layout changes; the external-store revision
  // wakes us when an already-mounted view publishes fresher facets.
  useGridStore((s) => linksSignature(activeTabLinks(s)))
  useSyncExternalStore(
    subscribeLiveTabMessageContext,
    liveTabMessageContextRevision,
    liveTabMessageContextRevision,
  )
  return activeTabLinks(useGridStore.getState())
}
