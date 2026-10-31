import { API_BASE_URL } from '@/shared/api/internal'

/**
 * Resolve a message attachment to a usable `src`. Media bytes
 * live EITHER inline as base64 (`data` — small uploads) OR as a
 * file served by the API (`mediaId`, loaded from `GET /rpc/media/:id`). This is
 * the single place the UI bridges the two so render paths stay storage-agnostic.

 */
export function mediaSrc(att: { mediaType: string; data?: string; mediaId?: string }): string {
  if (att.mediaId) return `${API_BASE_URL}/rpc/media/${encodeURIComponent(att.mediaId)}`
  if (att.data) return `data:${att.mediaType};base64,${att.data}`
  return ''
}
