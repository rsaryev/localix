/** Synchronous spill planning keeps collision names independent of worker completion order. */
import path from 'node:path'
import type { MessageAttachment } from '@localixai/agent'
import { isWireCarriableImage } from '@localixai/agent/agents'
import { analyzeText } from './attachment-manifests'

/** Text/binary attachments at or below BOTH limits stay inlined (cheap). Over either → spill. */
export const MAX_INLINE_LINES = 2000
export const MAX_INLINE_BYTES = 50 * 1024
/** Relative dir (under the session cwd) where this session's spilled attachments live. */
export function attachmentsDirRel(sessionId: string, messageId: string): string {
  return path.posix.join(
    '.localix',
    'attachments',
    sanitizeSegment(sessionId),
    sanitizeSegment(messageId),
  )
}

/** The session-scoped root (one level up from per-message dirs) — the teardown unit. */
export function sessionAttachmentsDirRel(sessionId: string): string {
  return path.posix.join('.localix', 'attachments', sanitizeSegment(sessionId))
}

/**
 * Bytes the model can only reach as a FILE. Not "is it an image?" — that question excluded
 * every `image/*` from spilling on the grounds that pi carries `ImageContent`, which is only
 * true for png/jpeg/gif/webp. A HEIC/SVG/BMP/TIFF image, and likewise audio and video, were
 * excluded from spilling AND unrepresentable on the wire, so they reached the model as the
 * bare stub `[Attached file: x.heic]`. The boundary now comes from the SDK that owns the wire.
 */
/** Attachment variants that carry bytes (vs the inlined `text` one). */
type BinaryAttachment = Extract<MessageAttachment, { kind: 'image' | 'video' | 'file' | 'audio' }>

/**
 * A TYPE PREDICATE, not a boolean: callers read `att.data` and `att.mediaId` right after asking,
 * and a plain boolean leaves `att` as the whole union — the `text` variant has neither field, so
 * every such read was a type error. Four of them shipped because a repo-wide `tsc` was skipped.
 */
export const isFileHandoff = (att: MessageAttachment): att is BinaryAttachment =>
  (att.kind === 'file' || att.kind === 'image' || att.kind === 'audio' || att.kind === 'video') &&
  !isWireCarriableImage(att.mediaType)

/** Reserve spill filenames in authored order after media-store paths have resolved. */
export function planAttachmentSpill(
  materialized: readonly MessageAttachment[],
  storedFilePaths: readonly (string | undefined)[],
  usedNames: Set<string>,
) {
  return materialized.map((att, index) => {
    if (att.kind === 'text' && !att.spilled) {
      const byteLen = Buffer.byteLength(att.text, 'utf8')
      const textInfo = analyzeText(att.text)
      const shouldSpill = textInfo.lineCount > MAX_INLINE_LINES || byteLen > MAX_INLINE_BYTES
      return {
        att,
        byteLen,
        textInfo,
        fileName: shouldSpill ? uniqueName(att.name || 'file.txt', usedNames) : undefined,
      }
    }
    // PDFs are NOT excluded — see the spill branch below for why. Both predicates must
    // agree: a branch that spills without a planned `fileName` silently returns the
    // attachment untouched.
    const storedFilePath = storedFilePaths[index]
    const shouldSpillFile = isFileHandoff(att) && Boolean(att.data || storedFilePath)
    return {
      att,
      storedFilePath,
      fileName: shouldSpillFile ? uniqueName(att.name || 'file.bin', usedNames) : undefined,
    }
  })
}

/** Keep one path segment filesystem-safe (no separators / odd chars). */
function sanitizeSegment(segment: string): string {
  const clean = segment.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_')
  return clean || 'x'
}

/**
 * Sanitize a filename (basename only) and de-dupe within a message dir by
 * inserting a numeric suffix before the extension on collision.
 */
function uniqueName(name: string, used: Set<string>): string {
  const base = sanitizeSegment(name.split('/').pop() ?? name) || 'file'
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 1; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}
