import {
  fileExtension,
  mediaTypeForExtension,
  mediaTypeForPath,
} from '@localixai/plugin-sdk/ui/file-types'
import type { AttachmentGate, PendingAttachment } from '@/shared/lib/attachment-policy'
import type { MessageAttachment } from '@/shared/api/contracts'
import { uploadMedia } from '@/shared/api/media-client'

/** Keep a file-backed attachment as a resource when a local composer handoff re-stages it. */
const restagedAttachments = new WeakMap<File, MessageAttachment>()
/** Real paths recovered from the desktop drag pasteboard, keyed by their strictly paired File. */
const droppedFilePaths = new WeakMap<File, string>()

export function restagedAttachment(file: File): MessageAttachment | undefined {
  return restagedAttachments.get(file)
}

export function droppedFilePath(file: File): string | undefined {
  return droppedFilePaths.get(file)
}

/**
 * Preserve a desktop-recovered path across the existing `File[]` composer boundary.
 * Browser/paste/picker files never enter this map and therefore keep the byte path.
 */
export function rememberDroppedFilePath(file: File, path: string): void {
  droppedFilePaths.set(file, path)
}

/**
 * Rehydrate a wire `MessageAttachment` into a File so it can be re-staged through
 * the normal composer pipeline (e.g. when prefilling the composer from a review).
 * Agnostic — used by any surface that hands attachments to the input.
 */
export function messageAttachmentToFile(att: MessageAttachment): File {
  if (att.kind === 'path') {
    const file = new File([], att.name, { type: att.mediaType })
    restagedAttachments.set(file, att)
    return file
  }
  if (att.kind === 'text') return new File([att.text], att.name, { type: 'text/plain' })
  // A file-backed attachment must keep riding by resource id. Decoding absent
  // `data` into an empty File would make a large freshly-staged upload silently
  // become zero bytes when composer prefill/review hands it back through this API.
  if (att.mediaId && !att.data) {
    const file = new File([], att.name, { type: att.mediaType })
    restagedAttachments.set(file, att)
    return file
  }
  const bin = atob(att.data ?? '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], att.name, { type: att.mediaType })
}

/** Image media types the wire `ImageContent` part accepts. */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
const PDF_EXT = /\.pdf$/i

/**
 * Office document extensions → their OOXML/ODT media type. These are zip/binary
 * containers the model can't read natively (a NUL-byte sniff rejected them before);
 * staged as `kind:'file'`, they spill to the session workspace and are read by the
 * registered document-extraction pipeline and viewer.
 */
const DOC_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'odt'] as const
const DOC_MIME = new Set(DOC_EXTENSIONS.map((ext) => mediaTypeForExtension(ext)))
const DOC_EXT = /\.(docx|xlsx|pptx|odt)$/i
const OCTET_STREAM = 'application/octet-stream'

/**
 * Extensions we inline as text. Code + config + prose; deliberately broad so the
 * model can read attached source files regardless of vision support.
 */
const TEXT_EXT =
  /\.(txt|md|markdown|mdx|rst|json|jsonc|ya?ml|toml|ini|cfg|conf|env|csv|tsv|log|html?|xml|svg|css|scss|less|tsx?|jsx?|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|kts|c|h|cpp|cc|hpp|cs|php|swift|m|mm|sh|bash|zsh|fish|sql|graphql|gql|proto|dockerfile|makefile|gradle|lua|r|jl|dart|ex|exs|erl|clj|scala|hs|elm|pl|ps1)$/i

/**
 * Match the runtime's existing text spill boundary (`attachment-spill.ts`:
 * `MAX_INLINE_BYTES`). Below it, keeping the current inline staging avoids a
 * request per tiny file; at/above it, a content-addressed `mediaId` keeps the
 * composer send small and deduplicates repeated drops.
 *
 * The handoff is resource-first: live bytes are inlined only when the disk
 * resource is stale/untitled (or the attachment is an image), while ordinary
 * files ride as resource URIs.
 */
export const INLINE_ATTACHMENT_BYTES = 50 * 1024

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

export function isImage(file: File): boolean {
  return IMAGE_MIME.has(file.type) || IMAGE_EXT.test(file.name)
}
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || PDF_EXT.test(file.name)
}
export function isDocument(file: File): boolean {
  return DOC_MIME.has(file.type) || DOC_EXT.test(file.name)
}
/** Resolve the canonical office media type for a document file (type wins over extension). */
export function documentMediaType(file: File): string {
  if (DOC_MIME.has(file.type)) return file.type
  return DOC_EXT.test(file.name) ? (mediaTypeForPath(file.name) ?? OCTET_STREAM) : OCTET_STREAM
}
export function isAudio(file: File): boolean {
  return file.type.startsWith('audio/')
}
export function isText(file: File): boolean {
  return (
    file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json'
  )
}

function pickedPathMediaType(name: string): string {
  if (IMAGE_EXT.test(name) || PDF_EXT.test(name) || DOC_EXT.test(name))
    return mediaTypeForPath(name) ?? OCTET_STREAM
  if (TEXT_EXT.test(name)) return fileExtension(name) === 'json' ? 'application/json' : 'text/plain'
  const mediaType = mediaTypeForPath(name)
  return mediaType?.startsWith('audio/') ? mediaType : OCTET_STREAM
}

/**
 * Adapt a native dialog result across the composer's existing `File[]` boundary.
 * The shell returns paths directly, so unlike a desktop drop there are no separately
 * delivered pasteboard entries and browser Files to reconcile by name.
 *
 * `undefined` stays the browser-picker fallback signal; an empty array stays a
 * cancellation. Picked paths are remembered before staging, so `fileToAttachment`
 * takes its bytes-free path branch before any FileReader or upload can run.
 */
export function filesFromDesktopPick(picked: { paths: string[] } | undefined): File[] | undefined {
  if (picked === undefined) return undefined
  return picked.paths.flatMap((path) => {
    if (!path) return []
    const name = path.split(/[\\/]/).pop()
    if (!name) return []
    const file = new File([], name, { type: pickedPathMediaType(name) })
    rememberDroppedFilePath(file, path)
    return [file]
  })
}

let idCounter = 0
export function nextId(): string {
  idCounter += 1
  return `att-${Date.now().toString(36)}-${idCounter}`
}

export function mediaTypeForImage(file: File): string {
  // Keep the REAL media type. Relabelling an unknown one as `image/png` sent HEIC/SVG/TIFF
  // bytes to the provider under a PNG label — a corrupt image part instead of an honest one.
  // The runtime now spills anything the wire cannot carry to disk, so the true type is what
  // makes that decision correct; guessing here defeated it.
  return IMAGE_MIME.has(file.type) ? file.type : file.type || 'application/octet-stream'
}

export function failedAttachmentNote(file: File, reason: unknown): PendingAttachment {
  const message = reason instanceof Error ? reason.message : 'could not be read or stored'
  // A failed/missing/binary/oversized read is converted into file CONTENT
  // (`Error fetching content: …`) so the message stays sendable and the model can
  // see what went wrong. Name this staged item as an error too, so
  // the tray never claims the original bytes were attached when only the note was.
  const text = `Attachment "${file.name}" could not be attached.\nError fetching content: ${message}`
  return {
    id: nextId(),
    attachment: {
      kind: 'text',
      name: `${file.name} (attachment error).txt`,
      text,
      size: new Blob([text]).size,
    },
  }
}

export async function fileToStoredAttachment(
  file: File,
  gate: AttachmentGate,
): Promise<PendingAttachment> {
  const stored = await uploadMedia(file)
  const mediaType = stored.mediaType || file.type || 'application/octet-stream'
  if (isImage(file) && gate.allowImages) {
    return {
      id: nextId(),
      attachment: {
        kind: 'image',
        mediaType,
        mediaId: stored.id,
        name: file.name,
        size: file.size,
      },
      previewUrl: URL.createObjectURL(file),
    }
  }
  if (isAudio(file) && gate.allowAudio) {
    return {
      id: nextId(),
      attachment: {
        kind: 'audio',
        mediaType,
        mediaId: stored.id,
        name: file.name,
        size: file.size,
      },
      previewUrl: URL.createObjectURL(file),
    }
  }
  return {
    id: nextId(),
    attachment: {
      kind: 'file',
      // A wire-carriable image MIME would otherwise remain a native vision part
      // even when its model gate is false. Octet-stream forces the runtime's
      // existing binary-file spill, whose manifest retains the real `.png` path.
      mediaType: isImage(file) ? 'application/octet-stream' : mediaType,
      mediaId: stored.id,
      name: file.name,
      size: file.size,
    },
  }
}
