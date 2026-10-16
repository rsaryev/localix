/**
 * WHICH IMAGES A TOOL RETURNED this request carries, with their bytes.
 *
 * A stored tool image holds a `mediaId`, never inline bytes (`run/tool-result-media.ts`), and the
 * SDK only puts an image on the wire when `data` is present (`withToolImages`). So without this
 * pass a screenshot is still named on the next turn but never shown — the defect that made the
 * model answer "I can't see the screenshot". Two rules decide which ones get their bytes back, on
 * the wire copy only (the row keeps the `mediaId`):
 *
 *   - the model accepts images. A text-only model sent one is rejected by the provider
 *     (`assertRequestServable`), so it gets the named absence instead of a failed turn;
 *   - the checkpoint in force has not collapsed it. A stale live-state snapshot (`supersedeKey`)
 *     becomes a pointer only AT a checkpoint — never on the turn a newer snapshot arrives, which
 *     would rewrite a message the model already saw — so until then its picture stays on the
 *     wire, and afterwards reading its file would be disk I/O for bytes thrown away.
 */
import { isToolBackedItem, type AgentItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../../db/payload'
import type { MediaStore } from '../../../../media/store'
import { rehydrateMediaAttachments } from '../../../../media/attachments'
import { mapLimit } from '../../../../../lib/map-limit'

export interface ToolImageOptions {
  mediaStore?: MediaStore
  /** Does this request's model read images? From the catalog's input modalities. */
  acceptsImages: boolean
  /** Results the checkpoint in force collapsed: their pictures never reach the wire. */
  collapsed?: (messageId: string, toolCallId: string) => boolean
}

/** Bound concurrent payload rewrites; each may read several image files. */
const TOOL_IMAGE_CONCURRENCY = 4

export async function rehydrateToolImages(
  payloads: StoredMessagePayload[],
  options: ToolImageOptions,
): Promise<StoredMessagePayload[]> {
  const { mediaStore, acceptsImages, collapsed } = options
  if (!mediaStore || !acceptsImages) return payloads

  return mapLimit(payloads, TOOL_IMAGE_CONCURRENCY, async (payload) => {
    const carried = (item: AgentItem): boolean =>
      isToolBackedItem(item) &&
      Boolean(item.attachments?.length) &&
      collapsed?.(payload.id, item.toolCallId) !== true
    if (!payload.items?.some(carried)) return payload
    const items = await Promise.all(
      payload.items.map(async (item) => {
        if (!carried(item) || !isToolBackedItem(item)) return item
        const attachments = await rehydrateMediaAttachments(mediaStore, item.attachments ?? [])
        return {
          ...item,
          attachments: attachments.filter((att) => att.kind === 'image'),
        } as AgentItem
      }),
    )
    return { ...payload, items }
  })
}
