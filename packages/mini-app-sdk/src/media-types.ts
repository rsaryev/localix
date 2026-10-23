/**
 * File extension → media type, and the binary sniff — ONE vocabulary for the server, the browser
 * and every plugin.
 *
 * Each surface used to carry its own `{ png: 'image/png', … }` table (the file viewer, the image
 * tool, the media store, the composer's attachment staging, the reader plugin, the binding chip),
 * and a format added to one never reached the others. What differs between those surfaces is a
 * POLICY — which formats it accepts — not what a format's media type is. So the vocabulary lives
 * here and each surface keeps only its own allowlist of extensions or media types.
 *
 * Web-standard only (no Node globals): the browser bundle imports it through `ui/file-types`.
 */

export const PDF_CONTENT_TYPE = 'application/pdf'
export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const ODT_CONTENT_TYPE = 'application/vnd.oasis.opendocument.text'
export const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_CONTENT_TYPE = 'text/csv'

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  csv: CSV_CONTENT_TYPE,
  pdf: PDF_CONTENT_TYPE,
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/x-mobipocket-ebook',
  fb2: 'application/x-fictionbook+xml',
  docx: DOCX_CONTENT_TYPE,
  xlsx: XLSX_CONTENT_TYPE,
  pptx: PPTX_CONTENT_TYPE,
  odt: ODT_CONTENT_TYPE,
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroenabled.12',
}

/** Lowercased extension without the dot (`/a/B.PDF` → `pdf`); empty when absent. */
export function fileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** The media type of an extension (`png`, `.PNG`), or `undefined` for one this table lacks. */
export function mediaTypeForExtension(extension: string): string | undefined {
  const key = extension.replace(/^\./, '').toLowerCase()
  return Object.prototype.hasOwnProperty.call(MEDIA_TYPE_BY_EXTENSION, key)
    ? MEDIA_TYPE_BY_EXTENSION[key]
    : undefined
}

/** The media type of a path's extension, or `undefined`. */
export function mediaTypeForPath(path: string): string | undefined {
  return mediaTypeForExtension(fileExtension(path))
}

/**
 * `{ '<dot><ext>': mediaType }` for the given extensions — the shape a surface's own allowlist
 * takes when it is keyed by `path.extname`. An extension missing from the vocabulary throws, so
 * an allowlist can never name a format whose type nobody defined.
 */
export function mediaTypesFor(extensions: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    extensions.map((extension) => {
      const mediaType = mediaTypeForExtension(extension)
      if (!mediaType) throw new Error(`No media type is defined for .${extension}`)
      return [`.${extension}`, mediaType]
    }),
  )
}

/** How much of a file the binary sniff reads — git's own window (`FIRST_FEW_BYTES`). */
export const BINARY_SNIFF_LENGTH = 8000

/**
 * Git's binary heuristic: a NUL within the first {@link BINARY_SNIFF_LENGTH} bytes (or decoded
 * characters) means binary. One rule for every reader, so a file the agent's `read` treats as
 * text is not a binary placeholder in the viewer, nor rejected as an `@file` reference.
 */
export function hasBinarySignature(content: string | Uint8Array): boolean {
  const limit = Math.min(content.length, BINARY_SNIFF_LENGTH)
  if (typeof content === 'string') {
    for (let i = 0; i < limit; i++) if (content.charCodeAt(i) === 0) return true
    return false
  }
  return content.subarray(0, limit).includes(0)
}
