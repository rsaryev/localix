/**
 * What an image file IS, from its bytes. `read` routes by extension first, but a screenshot
 * saved as `shot.bin` or a JPEG named `.png` is still a picture, and a text file named `.png`
 * is still text — so the signature, not the name, decides the media type sent to the model.
 *
 * Pure byte math: the four formats the runtime can deliver as vision parts, plus their pixel
 * dimensions where the header states them (the resize notice and the text-only-model notice
 * both name them).
 */
import type { ImageContent } from '@localixai/agent'

export type ImageMediaType = ImageContent['mediaType']

export interface ImageSniff {
  mediaType: ImageMediaType
  width?: number
  height?: number
}

/** The extensions `read` treats as images before looking at a byte. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export function hasImageExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 && IMAGE_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase())
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const startsWith = (buf: Uint8Array, bytes: readonly number[], at = 0) =>
  buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b)

const ascii = (buf: Uint8Array, at: number, text: string) =>
  startsWith(
    buf,
    [...text].map((c) => c.charCodeAt(0)),
    at,
  )

/** The image type the bytes carry, with dimensions when the header states them; else undefined. */
export function sniffImage(buf: Uint8Array): ImageSniff | undefined {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (startsWith(buf, PNG_SIGNATURE)) {
    const dims =
      buf.length >= 24 && ascii(buf, 12, 'IHDR')
        ? { width: view.getUint32(16), height: view.getUint32(20) }
        : {}
    return { mediaType: 'image/png', ...dims }
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mediaType: 'image/jpeg', ...jpegSize(buf) }
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) {
    const dims =
      buf.length >= 10 ? { width: view.getUint16(6, true), height: view.getUint16(8, true) } : {}
    return { mediaType: 'image/gif', ...dims }
  }
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP'))
    return { mediaType: 'image/webp', ...webpSize(buf) }
  return undefined
}

/** JPEG dimensions live in the first start-of-frame segment, after any number of others. */
function jpegSize(buf: Uint8Array): { width?: number; height?: number } {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return {}
    const marker = buf[i + 1]!
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (buf[i + 5]! << 8) | buf[i + 6]!,
        width: (buf[i + 7]! << 8) | buf[i + 8]!,
      }
    }
    i += 2 + ((buf[i + 2]! << 8) | buf[i + 3]!)
  }
  return {}
}

function webpSize(buf: Uint8Array): { width?: number; height?: number } {
  if (buf.length < 30) return {}
  const u24 = (at: number) => buf[at]! | (buf[at + 1]! << 8) | (buf[at + 2]! << 16)
  if (ascii(buf, 12, 'VP8X')) return { width: u24(24) + 1, height: u24(27) + 1 }
  if (ascii(buf, 12, 'VP8L')) {
    const bits = buf[21]! | (buf[22]! << 8) | (buf[23]! << 16) | (buf[24]! << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(buf, 12, 'VP8 ')) {
    return {
      width: (buf[26]! | (buf[27]! << 8)) & 0x3fff,
      height: (buf[28]! | (buf[29]! << 8)) & 0x3fff,
    }
  }
  return {}
}

/** `1920×1080`, or undefined when the header did not state both. */
export function formatDimensions(width?: number, height?: number): string | undefined {
  return width && height ? `${width}×${height}` : undefined
}
