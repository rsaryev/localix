import { API_BASE_URL } from '@/shared/api/internal'

/**
 * Resolve a message attachment to a usable `src`. Media bytes
 * live EITHER inline as base64 (`data` — legacy messages + small uploads) OR as a
 * file served by the API (`mediaId`, loaded from `GET /rpc/media/:id`). This is
 * the single place the UI bridges the two so render paths stay storage-agnostic.
 *
 * Back-compat: an attachment with inline `data` keeps its data URL, so old
 * sessions render unchanged even after the switch to file-backed storage.
 */
export function mediaSrc(att: { mediaType: string; data?: string; mediaId?: string }): string {
  if (att.mediaId) return `${API_BASE_URL}/rpc/media/${encodeURIComponent(att.mediaId)}`
  if (att.data) return `data:${att.mediaType};base64,${att.data}`
  return ''
}

/**
 * Resolve a server-emitted media reference (e.g. a HITL card's `thumb`) to a
 * loadable URL. The API emits a RELATIVE `/rpc/media/:id` path for file-backed
 * media — that must be resolved against the API origin (the UI may be served from
 * a different port in dev). Data URLs and absolute URLs pass through unchanged.
 */
export function resolveMediaPath(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('/rpc/media/')) return `${API_BASE_URL}${pathOrUrl}`
  return pathOrUrl
}
