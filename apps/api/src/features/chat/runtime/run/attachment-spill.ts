/**
 * Attachment spill-to-disk: keep large non-image attachments OUT of the model
 * context by materializing their bytes into the session cwd and replacing the
 * inlined content (on the MODEL WIRE COPY ONLY) with a small manifest + head
 * preview. The agent then re-reads them lazily with its existing file tools
 * (`read` with start_line/end_line/offset) instead of re-billing the whole file on
 * every turn.
 *
 * The transform runs only in `buildModelHistory`, beside media rehydration and image
 * downscaling, so the persisted DB/UI message retains the complete attachment.
 *
 * Files land under `<cwd>/.localix/attachments/<sessionId>/<messageId>/<file>` —
 * inside the session cwd (so the cwd-relative file tools reach them) and under the
 * standard `.localix/` workspace namespace (so they stay out of the user's tree).
 * The `read` tool reaches this dotdir directly (verified); ripgrep skips hidden
 * dirs by default, so the manifest steers the model to `read` (the path is known,
 * so discovery-grep isn't needed — line-range reads cover within-file search).
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { MessageAttachment } from '@localixai/agent'
import { isWireCarriableImage } from '@localixai/agent/agents'
import type { DocumentTextExtractor } from '../../../agent-core/tools/file/document-ports'
import type { MediaStore } from '../../../media/store'
import { mapLimit } from '../../../../lib/map-limit'
import {
  analyzeText,
  binaryManifest,
  isTextualMediaType,
  readTextFile,
  textManifest,
} from './attachment-manifests'
import { materializePathAttachment } from './attachment-path'

// The manifest vocabulary and the copy-free path handling moved to siblings; these
// stay re-exported because they are part of this module's long-standing surface.
export { SPILL_PREVIEW_LINES, TEXT_PREVIEW_BYTES } from './attachment-manifests'
export { MAX_PATH_IMAGE_BYTES } from './attachment-path'

/** Text/binary attachments at or below BOTH limits stay inlined (cheap). Over either → spill. */
export const MAX_INLINE_LINES = 2000
export const MAX_INLINE_BYTES = 50 * 1024
/** Bound concurrent large writes/document extractions within one message. */
export const ATTACHMENT_SPILL_CONCURRENCY = 4

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

export interface SpillContext {
  /** Resolved session cwd; without it we cannot write a readable copy, so we keep inlining. */
  defaultCwd: string | undefined
  sessionId: string
  messageId: string
  /** Store whose existing bytes may be copied directly for a `mediaId` attachment. */
  mediaStore?: MediaStore
  /**
   * Injected office/PDF text extractor. When a spilled
   * binary is a document (docx/pptx/xlsx/odt), its text is extracted for a useful
   * head preview + a later generic read — instead of an opaque binary manifest
   * that pointed at `read` (which refused it). Absent → plain binary manifest.
   */
  extractDocument?: DocumentTextExtractor
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
const isFileHandoff = (att: MessageAttachment): att is BinaryAttachment =>
  (att.kind === 'file' || att.kind === 'image' || att.kind === 'audio' || att.kind === 'video') &&
  !isWireCarriableImage(att.mediaType)

/**
 * Spill the large non-image attachments of ONE message to disk, returning a new
 * attachments array (or the same reference when nothing changed). Pure aside from
 * the disk writes; safe to call every turn (per-message dir + overwrite is
 * idempotent). Images, PDFs, audio and video keep their native wire path.
 */
export async function spillMessageAttachments(
  attachments: MessageAttachment[],
  ctx: SpillContext,
): Promise<MessageAttachment[]> {
  if (attachments.length === 0) return attachments
  const materialized = await mapLimit(attachments, ATTACHMENT_SPILL_CONCURRENCY, (att) =>
    materializePathAttachment(att, ctx.defaultCwd),
  )
  let changed = materialized.some((att, index) => att !== attachments[index])
  const cwd = ctx.defaultCwd
  if (!cwd) return changed ? materialized : attachments // no workspace → nowhere to spill bytes

  const relDir = attachmentsDirRel(ctx.sessionId, ctx.messageId)
  const absDir = path.resolve(cwd, relDir)
  const usedNames = new Set<string>()
  let ensuredDir = false
  const ensureDir = async () => {
    if (ensuredDir) return
    await mkdir(absDir, { recursive: true })
    ensuredDir = true
  }

  const storedFilePaths = await mapLimit(
    materialized,
    ATTACHMENT_SPILL_CONCURRENCY,
    async (att): Promise<string | undefined> => {
      if (!isFileHandoff(att) || att.data || !att.mediaId || !ctx.mediaStore) return undefined
      return (await ctx.mediaStore.resolve(att.mediaId))?.filePath
    },
  )

  // Reserve collision-free names synchronously in authored order. If workers
  // called uniqueName after their first await, completion timing would decide
  // which duplicate receives `-1`, making persisted manifests nondeterministic.
  const plans = materialized.map((att, index) => {
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

  const next = await mapLimit(
    plans,
    ATTACHMENT_SPILL_CONCURRENCY,
    async (plan): Promise<MessageAttachment> => {
      const { att } = plan
      // ---- Text attachments: inline when small, else spill + manifest+preview ----
      if (att.kind === 'text') {
        if (att.spilled) return att // already spilled this run — idempotent
        const { byteLen, textInfo, fileName } = plan
        if (byteLen === undefined || textInfo === undefined || !fileName) return att
        const lineCount = textInfo.lineCount

        const relPath = path.posix.join(relDir, fileName)
        await ensureDir()
        await writeFile(path.resolve(cwd, relPath), att.text, 'utf8')
        changed = true
        return {
          kind: 'text',
          name: att.name,
          spilled: true,
          path: relPath,
          lineCount,
          size: att.size,
          text: textManifest(relPath, att.name, byteLen, textInfo),
        }
      }

      // ---- Non-image binary files (PDF included): spill to a manifest LINE (no bytes) --
      // Images keep their wire path: pi carries `ImageContent`, so native vision works.
      //
      // PDFs used to be excluded here too, on the premise that they reached the model as a
      // native document block. That premise died with the move to the pi runtime: pi's
      // `UserMessage.content` is `string | (TextContent | ImageContent)[]` (no document
      // part), so `toPiPart` turns a `FileContent` into the literal text
      // `[Attached file: spec.pdf]`. Measured end to end: a PDF binding survives
      // `toModelMessages` correctly and then loses every byte at the codec, so "Summarise
      // the attached spec" reached the model as a filename and nothing else — silently.
      // Spilling instead offers the PDF to the optional text extractor and leaves an
      // on-disk path the agent can re-read for more.
      // Restore the exclusion only when a runtime can actually carry a document part.
      //
      // Audio, video, and images the wire cannot carry (HEIC/SVG/BMP/TIFF) now enter this
      // branch too. Extraction does not apply to them, so they land as a binary manifest:
      // not a transcript, but a real path the agent can act on instead of a filename it
      // can only guess about. Native carriage would still be better where a runtime has it.
      if (isFileHandoff(att)) {
        const { fileName, storedFilePath } = plan
        // The file's own warning is that a branch which spills without a planned name
        // silently returns the attachment untouched. A missing store entry deliberately
        // has no source path and therefore keeps the same pass-through behavior as rehydration.
        if (!fileName || (!att.data && !storedFilePath)) return att
        const relPath = path.posix.join(relDir, fileName)
        const absPath = path.resolve(cwd, relPath)
        await ensureDir()
        if (att.data) {
          await writeFile(absPath, Buffer.from(att.data, 'base64'))
        } else if (storedFilePath) {
          try {
            await copyFile(storedFilePath, absPath)
          } catch (error) {
            // The store file can disappear between resolve() and copyFile(). Match
            // getBase64's missing-file behavior: leave the attachment unchanged.
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return att
            throw error
          }
        }
        changed = true
        // Office/spreadsheet document (docx/pptx/xlsx/odt): extract its TEXT for a
        // head preview so the agent can actually read it (a binary manifest pointed
        // at `read`, which refuses these). The extractor auto-detects by extension
        // and returns null for a non-document binary, which falls back below.
        // A TEXTUAL file that arrived as a stored `file` (the composer routes everything at or
        // above 50KB through the media store, so a large .log/.csv/source file lands here rather
        // than as `kind: 'text'`) still deserves the text manifest: line count plus a head
        // preview. Before this, it fell through to `binaryManifest` and the model got path, type
        // and size with nothing to read — it had to spend a `read` just to learn what the file
        // was. `extractDocument` cannot help: it recognises office/PDF formats only and returns
        // null for plain text.
        const textual = isTextualMediaType(att.mediaType) ? await readTextFile(absPath) : null
        if (textual != null) {
          const textInfo = analyzeText(textual.text)
          return {
            kind: 'text',
            name: att.name,
            spilled: true,
            path: relPath,
            ...(textual.truncated ? {} : { lineCount: textInfo.lineCount }),
            size: att.size,
            text: textManifest(relPath, att.name || fileName, textual.byteLength, {
              ...textInfo,
              truncated: textual.truncated,
            }),
          }
        }
        const extracted = ctx.extractDocument ? await ctx.extractDocument(absPath) : null
        if (extracted != null) {
          const byteLen = Buffer.byteLength(extracted, 'utf8')
          const textInfo = analyzeText(extracted)
          return {
            kind: 'text',
            name: att.name,
            spilled: true,
            path: relPath,
            lineCount: textInfo.lineCount,
            size: att.size,
            text: textManifest(relPath, att.name || fileName, byteLen, textInfo),
          }
        }
        return {
          kind: 'text',
          name: att.name,
          spilled: true,
          path: relPath,
          size: att.size,
          text: binaryManifest(relPath, att.mediaType, att.size),
        }
      }

      return att
    },
  )

  return changed ? next : attachments
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
