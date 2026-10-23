/**
 * Filesystem media store. Generated and uploaded media bytes used to ride as
 * base64 in the message-payload JSON inside SQLite — heavy, and it bloated the
 * db. This store writes the bytes to files under `~/.localix/media/` (rooted
 * beside the db, like every other Localix data dir) and hands back a content id.
 *
 * The id is the sha256 of the bytes (content-addressed) + the file extension, so
 * identical media de-dupes for free and the id is stable/verifiable. A stored
 * attachment carries this id (`mediaId`) instead of the base64 `data`; the chat
 * runtime rehydrates the bytes from here for the model wire and serves them to
 * the UI over `GET /rpc/media/:id`.
 *
 * Agnostic: knows nothing about chat, attachments, or providers — just bytes in,
 * id out, bytes (or a path) back. The chat runtime owns the wiring.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  atomicWriteFile,
  fileExtension,
  mediaTypeForExtension,
} from '@localixai/mini-app-sdk/backend'

/**
 * Explicit media-type → short extension for types whose subtype isn't a clean,
 * short extension. OOXML/ODF document types carry long structured subtypes (e.g.
 * `…wordprocessingml.document`); the generic subtype-strip below would exceed the
 * content-id's 8-char extension budget and break `isMediaId`, so the id — and thus
 * serving + rehydration — would fail. Map them to their conventional extension.
 */
const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  // Legacy Office types: the subtype-strip would mint `.msword` / overflow the
  // 8-char extension budget (`vndmsexcel`) — map to the conventional extensions
  // so the id's extension stays an authoritative format hint downstream.
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsm',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'xlsb',
}

/** A filesystem-safe id extension within the 8-char budget, or null. */
function safeExt(candidate: string | undefined): string | null {
  const clean = (candidate ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return clean.length >= 1 && clean.length <= 8 ? clean : null
}

/**
 * The stored id's extension. The ORIGINAL FILENAME's extension wins when present —
 * it is the one format-agnostic truth (any future format keeps its extension with
 * no map entry here), and downstream routing (viewers, document detection) keys on
 * it. Fallbacks: the known media-type map, the MIME subtype (clamped to the id's
 * 8-char budget — `application/octet-stream` used to mint an 11-char extension the
 * store's own `isMediaId` then REJECTED, 404ing every unknown-type upload), `bin`.
 */
function extFor(mediaType: string, nameHint?: string): string {
  const base = nameHint?.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const fromName = dot > 0 ? safeExt(base.slice(dot + 1)) : null
  if (fromName) return fromName
  const bare = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  const known = MEDIA_TYPE_TO_EXT[bare]
  if (known) return known
  return safeExt(bare.split('/')[1]?.split(/[;+]/)[0]) ?? 'bin'
}

/**
 * The stored extensions the store NAMES a content-type for (else the request header, or
 * octet-stream, decides). Deliberately an allowlist over the shared extension vocabulary: the
 * store serves bytes from the app's own origin, so a scriptable format (`svg`, `html`) must
 * never be handed back as itself.
 */
const SERVED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'ogg',
  'csv',
  'pdf',
  'epub',
  'mobi',
  'azw3',
  'fb2',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'doc',
  'xls',
  'xlsm',
  'xlsb',
])

/** Reverse map: derive a content-type from a stored id's extension. */
function mediaTypeForStoredExtension(ext: string): string | undefined {
  return SERVED_EXTENSIONS.has(ext) ? mediaTypeForExtension(ext) : undefined
}

/**
 * Best-effort MIME for an uploaded file NAME (authoritative over a browser-reported
 * Content-Type, which is often blank/generic on a drop). Only the types with a
 * dedicated in-app viewer plus the common image/video/audio families are mapped; an
 * unknown extension returns undefined so the caller falls back to the request header.
 */
export function mediaTypeForName(name: string): string | undefined {
  return mediaTypeForStoredExtension(fileExtension(name))
}

export interface StoredMedia {
  /** Content id: `<sha256>.<ext>`. Used as `mediaId` on the attachment + the serve path. */
  id: string
  /** Byte length written. */
  size: number
}

export interface MediaStore {
  /** Persist raw bytes; returns a content id. Idempotent for identical bytes.
   *  `nameHint` (the original filename) makes its extension the id's extension. */
  putBytes(bytes: Uint8Array, mediaType: string, opts?: { nameHint?: string }): Promise<StoredMedia>
  /** Persist base64 bytes; returns a content id. Idempotent for identical bytes. */
  putBase64(base64: string, mediaType: string, opts?: { nameHint?: string }): Promise<StoredMedia>
  /** Read a stored file's bytes back as base64 (for the model wire). Null if missing. */
  getBase64(id: string): Promise<string | null>
  /** Resolve a stored id to an absolute file path + content-type (for serving). Null if invalid/missing. */
  resolve(id: string): Promise<{ filePath: string; mediaType: string; size: number } | null>
  /**
   * Delete a stored file. Content-addressed bytes may be shared by several
   * messages, so the CALLER must confirm no reference remains before calling.
   * Returns true if a file was removed, false if the id was invalid or absent
   * (a missing file is not an error — delete is idempotent).
   */
  delete(id: string): Promise<boolean>
}

/** Valid content id: `<64-hex>.<alnum ext>`. Guards the serve route against traversal. */
const ID_RE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/

export function isMediaId(id: string): boolean {
  return ID_RE.test(id)
}

export interface MediaStoreOptions {
  /** Root directory for stored media (created lazily). */
  dir: string
}

export function createMediaStore(options: MediaStoreOptions): MediaStore {
  const { dir } = options
  let ensured = false
  const ensureDir = async () => {
    if (ensured) return
    await mkdir(dir, { recursive: true })
    ensured = true
  }

  const pathFor = (id: string) => path.join(dir, id)

  const putBytesImpl = async (
    bytes: Uint8Array,
    mediaType: string,
    opts?: { nameHint?: string },
  ): Promise<StoredMedia> => {
    const buf = Buffer.from(bytes)
    const hash = createHash('sha256').update(buf).digest('hex')
    const id = `${hash}.${extFor(mediaType, opts?.nameHint)}`
    await ensureDir()
    const filePath = pathFor(id)
    // A matching id promises matching bytes. Compare instead of trusting the
    // length so same-size corruption is repaired atomically.
    try {
      const existing = await readFile(filePath)
      if (existing.equals(buf)) return { id, size: buf.length }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await atomicWriteFile(filePath, buf)
    return { id, size: buf.length }
  }

  return {
    putBytes: putBytesImpl,

    async putBase64(base64, mediaType, opts) {
      return putBytesImpl(Buffer.from(base64, 'base64'), mediaType, opts)
    },

    async getBase64(id) {
      if (!isMediaId(id)) return null
      try {
        const buf = await readFile(pathFor(id))
        return buf.toString('base64')
      } catch {
        return null
      }
    },

    async resolve(id) {
      if (!isMediaId(id)) return null
      const filePath = pathFor(id)
      try {
        const s = await stat(filePath)
        if (!s.isFile()) return null
        const ext = id.split('.').pop() ?? ''
        const mediaType = mediaTypeForStoredExtension(ext) ?? 'application/octet-stream'
        return { filePath, mediaType, size: s.size }
      } catch {
        return null
      }
    },

    async delete(id) {
      if (!isMediaId(id)) return false
      try {
        await unlink(pathFor(id))
        return true
      } catch {
        // Already gone (or never written) — idempotent success semantics.
        return false
      }
    },
  }
}
