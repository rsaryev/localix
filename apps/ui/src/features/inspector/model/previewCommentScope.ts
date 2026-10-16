import { originOf } from '@/shared/lib/url'

/**
 * The review batch a preview's comments belong to.
 *
 * Scoped to the ORIGIN as well as the session: two preview tabs open in one session are two
 * different pages, and sharing one batch would send both under whichever was active. Its own
 * module because the layer that writes the batch and the toolbar that reports how big it is
 * must agree on the key without importing each other.
 */
export function previewCommentScope(sessionId: string | null, url: string): string {
  return sessionId ? `preview:${sessionId}:${originOf(url)}` : 'preview:none'
}
