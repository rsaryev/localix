import { formatFileSize } from '@localixai/mini-app-sdk/ui/utilities'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import type { MessageAttachment } from '@/shared/api/contracts'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'

/**
 * What this message will actually carry, as one list.
 *
 * The composer holds two kinds of thing and used to answer the question separately for each:
 * a "Context" popover counted the links and review comments, while uploaded media and files
 * only ever appeared as a strip of thumbnails with no size, no order and no place in the
 * count. So the one number on screen was never the answer to "what am I about to send".
 *
 * These rows are the attachment half, in the same shape the ref half already renders in, so
 * the manifest stays one list a person reads top to bottom rather than two half-inventories.
 */
export interface ComposerManifestRow {
  key: string
  label: string
  /** Where it came from, in the same voice as a ref's source line. */
  source: string
  /** Human size, when the thing has one. */
  size?: string
  /** Image preview, when the browser holds one. */
  thumbnailUrl?: string
}

/**
 * The evidence hanging off a context binding — a preview pick's screenshot, say.
 *
 * A link can carry pictures, and the manifest showed only its character count: the person
 * saw "537 chars" for an observation whose whole point was the screenshot beside it, and only
 * learned the image had been sent by looking at the message afterwards. So a row states its
 * nested assets and shows them.
 */
export interface ManifestAsset {
  key: string
  name: string
  /** Loadable image src; absent for a non-image asset. */
  imageUrl?: string
  size?: string
}

export function manifestAssets(assets: readonly MessageAttachment[] | undefined): ManifestAsset[] {
  return (assets ?? []).map((asset, index) => {
    const isImage = asset.kind === 'image'
    const url = isImage ? mediaSrc(asset) : ''
    return {
      key: `${asset.kind}-${index}-${asset.kind === 'path' ? asset.path : asset.name}`,
      name: asset.name,
      ...(url ? { imageUrl: url } : {}),
      ...(asset.size ? { size: formatFileSize(asset.size) } : {}),
    }
  })
}

/** "1 image", "2 images · 1 file" — what a row says it is carrying, before you open it. */
export function manifestAssetSummary(assets: readonly ManifestAsset[]): string | undefined {
  if (assets.length === 0) return undefined
  const images = assets.filter((asset) => asset.imageUrl).length
  const others = assets.length - images
  const parts: string[] = []
  if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'}`)
  if (others > 0) parts.push(`${others} file${others === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

const SOURCE: Record<string, string> = {
  image: 'Attached image',
  video: 'Attached video',
  audio: 'Voice message',
  text: 'Attached text',
  file: 'Attached file',
  path: 'Attached file',
}

export function attachmentManifestRows(
  attachments: readonly PendingAttachment[],
): ComposerManifestRow[] {
  return attachments.map((item) => {
    const { attachment } = item
    // A text attachment's `size` is its character count, which `formatFileSize` would
    // report as bytes — near enough for ASCII and wrong for everything else, so it says
    // what it means instead.
    const size =
      attachment.kind === 'text'
        ? `${attachment.size.toLocaleString()} chars`
        : attachment.size
          ? formatFileSize(attachment.size)
          : undefined
    return {
      key: item.id,
      label: attachment.name,
      source: SOURCE[attachment.kind] ?? 'Attached',
      ...(size ? { size } : {}),
      ...(attachment.kind === 'image' && item.previewUrl ? { thumbnailUrl: item.previewUrl } : {}),
    }
  })
}
