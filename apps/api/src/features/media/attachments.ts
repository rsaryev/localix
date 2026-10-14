/**
 * Bridge between the agnostic `MessageAttachment` contract and the filesystem
 * `MediaStore`. The chat runtime persists media bytes as files (carrying a
 * `mediaId`) and rehydrates them back to base64 when it needs the bytes (model
 * wire, reference resolution). The SDK never does this — it's host policy here.
 *
 * Back-compat: an attachment that already carries inline `data` (old messages,
 * small uploads) is left untouched on read; on store, inline `data` is moved to a
 * file and replaced by `mediaId`. With no store configured both calls are no-ops,
 * so the pipeline degrades to the legacy inline-base64 behavior.
 */
import type { MessageAttachment } from '@localixai/agent'
import type { MediaStore } from './store'
import { mapLimit } from '../../lib/map-limit'

/** File-backed media can be multi-megabyte; never fan out one I/O per attachment. */
export const MEDIA_ATTACHMENT_IO_CONCURRENCY = 4

/** Attachment kinds that carry binary bytes (vs. inlined `text`). */
type BinaryAttachment = Extract<MessageAttachment, { kind: 'image' | 'video' | 'file' | 'audio' }>

function isBinary(att: MessageAttachment): att is BinaryAttachment {
  return att.kind === 'image' || att.kind === 'video' || att.kind === 'file' || att.kind === 'audio'
}

/**
 * Persist any inline-base64 binary attachment to the store and replace its `data`
 * with a `mediaId`. Attachments that already reference a file, carry no bytes, or
 * are text pass through. No store ⇒ identity (keeps inline base64).
 */
export async function storeMediaAttachments(
  store: MediaStore | undefined,
  attachments: MessageAttachment[],
): Promise<MessageAttachment[]> {
  if (!store || attachments.length === 0) return attachments
  return mapLimit(
    attachments,
    MEDIA_ATTACHMENT_IO_CONCURRENCY,
    async (att): Promise<MessageAttachment> => {
      if (!isBinary(att) || !att.data || att.mediaId) return att
      const { id } = await store.putBase64(att.data, att.mediaType)
      // Drop the inline base64 — the bytes now live on disk under `id`.
      const { data: _data, ...rest } = att
      return { ...rest, mediaId: id }
    },
  )
}

/**
 * Inverse of {@link storeMediaAttachments}: for any file-backed attachment
 * (`mediaId`, no inline `data`), read the bytes back from the store and inline
 * them as base64. Used when the bytes are actually needed (e.g. the model wire).
 * Attachments that already have inline `data`, are text, or whose file is missing
 * pass through unchanged. No store ⇒ identity.
 */
export async function rehydrateMediaAttachments(
  store: MediaStore | undefined,
  attachments: MessageAttachment[],
  options: {
    /** Limit reads to attachment bytes the caller will actually put on its wire. */
    shouldRehydrate?: (attachment: BinaryAttachment) => boolean
  } = {},
): Promise<MessageAttachment[]> {
  if (!store || attachments.length === 0) return attachments
  return mapLimit(
    attachments,
    MEDIA_ATTACHMENT_IO_CONCURRENCY,
    async (att): Promise<MessageAttachment> => {
      if (!isBinary(att) || att.data || !att.mediaId) return att
      if (options.shouldRehydrate && !options.shouldRehydrate(att)) return att
      const data = await store.getBase64(att.mediaId)
      return data ? { ...att, data } : att
    },
  )
}
