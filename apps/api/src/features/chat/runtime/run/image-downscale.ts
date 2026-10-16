import { assetBindings } from '@localixai/agent'
import { downscaleImageCached, type ImageMediaType } from '@localixai/agent/images/downscale'
import type { StoredMessagePayload } from '../../../../db/payload'
import { envFlag } from '../../../../lib/env'
import { mapLimit } from '../../../../lib/map-limit'

const RESIZABLE_MEDIA = new Set<string>(['image/png', 'image/jpeg'])
/** Bound simultaneous image decodes: each Jimp job can hold several full pixel buffers. */
export const IMAGE_DOWNSCALE_PAYLOAD_CONCURRENCY = 2
export const IMAGE_DOWNSCALE_ATTACHMENT_CONCURRENCY = 2

/**
 * Downscale large image attachments on the per-run WIRE copy of the history, once per
 * run. Vision models price an image by its dimensions, so capping the long edge cuts
 * tokens on the big screenshots agents attach — and the DB keeps the original, since
 * this rewrites only the model-facing payloads. Cached by content, so a re-sent image
 * is only decoded once across turns. Non-image / small / undecodable attachments and
 * payloads pass through untouched (new objects only when something actually changed).
 */
export async function downscaleRunImages(
  payloads: StoredMessagePayload[],
  downscale: typeof downscaleImageCached = downscaleImageCached,
): Promise<StoredMessagePayload[]> {
  // Operational kill-switch (also used for A/B measurement of the savings).
  if (envFlag('LOCALIX_DISABLE_IMAGE_DOWNSCALE')) return payloads
  return mapLimit(payloads, IMAGE_DOWNSCALE_PAYLOAD_CONCURRENCY, async (payload) => {
    const attachments = assetBindings(payload.bindings)
    if (!attachments?.some((a) => a.kind === 'image' && RESIZABLE_MEDIA.has(a.mediaType)))
      return payload
    let changed = false
    const next = await mapLimit(attachments, IMAGE_DOWNSCALE_ATTACHMENT_CONCURRENCY, async (a) => {
      // A file-backed image with no inline bytes (not rehydrated) can't be
      // downscaled here — pass it through (rehydration happens upstream).
      if (a.kind !== 'image' || !RESIZABLE_MEDIA.has(a.mediaType) || !a.data) return a
      const r = await downscale(a.data, a.mediaType as ImageMediaType)
      if (!r.resized) return a
      changed = true
      return { ...a, data: r.data, size: r.afterBytes }
    })
    return changed ? { ...payload, bindings: next } : payload
  })
}
