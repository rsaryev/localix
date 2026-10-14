import type { MessageAttachment } from '@localixai/agent'

import type { UploadedMedia } from '@/shared/api/media-client'

/**
 * Canonical attachment for bytes persisted from a browser or clipboard File.
 * The media id remains an opaque storage reference; it is never projected as a path.
 */
export function mediaFileBinding(media: UploadedMedia): MessageAttachment {
  return {
    kind: media.mediaType.startsWith('image/') ? 'image' : 'file',
    mediaType: media.mediaType,
    mediaId: media.id,
    name: media.name,
    size: media.size,
  }
}
