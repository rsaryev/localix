/** System notice prose is transcript presentation; its binding is the model-facing value. */
import type { StoredSystemNotice } from '../../db/payload'

/**
 * Keep every visible notice row out of persisted model history. The resolved `context` binding
 * on the same row is collected, deduplicated and reattached to the volatile runtime tail.
 */
export function noticeVisibility(_notice: StoredSystemNotice | undefined): { uiOnly: true } {
  return { uiOnly: true }
}
