/**
 * Opening a request's center tab, routed through the generic `miniAppWorkspace.openWorkItem` seam — core
 * names no subsystem.
 *
 * The tab-id FORMULA is exported rather than inlined, because two places must agree on it: this
 * opener (the sidebar's click) and the shared UI anchor (search or `/open`). When they drift, the same
 * request opens as two tabs and neither focuses the other — so the formula has one owner.
 */

import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'

export const REQUEST_WORK_KIND = 'api:request'

/** Stable per-request tab id, so re-opening a request focuses its existing tab. */
export function restRequestTabId(name: string): string {
  return `${REQUEST_WORK_KIND}:${name}`
}

/**
 * Pop a request out into its own tab IN THE CHAT IT WAS OPENED FROM. A request lives in that chat's
 * project, so the tab is a session kind: opened without the chat, it would belong to whichever
 * one the host guessed and read another project's collection.
 */
export function openRestRequestTab(sessionId: string, name: string): void {
  miniAppWorkspace.openWorkItem({
    workKind: REQUEST_WORK_KIND,
    id: restRequestTabId(name),
    title: name,
    scope: sessionId,
    payload: { name },
  })
}
