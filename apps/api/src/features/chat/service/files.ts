import { mediaTypesFor } from '@localixai/plugin-sdk/backend'

// The extension → media-type vocabulary is shared (`@localixai/plugin-sdk` media-types); what is
// this module's own is WHICH formats the file viewer serves as raw bytes.

/** Binary image extensions the file viewer can render inline (base64). SVG is text, handled separately. */
export const BINARY_IMAGE_MIME: Record<string, string> = mediaTypesFor([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
])

/**
 * Binary DOCUMENT extensions (PDF + OOXML/ODT office files). Like images, these are
 * zip/binary containers that can't survive a UTF-8 read — a NUL-byte sniff garbles
 * them — so the file viewer fetches their raw bytes as base64 instead. A contributed
 * document viewer or extractor consumes these; the map keeps the served
 * content-type correct (else the byte blob is opaque octet-stream).
 */
export const BINARY_DOC_MIME: Record<string, string> = mediaTypesFor([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
])
