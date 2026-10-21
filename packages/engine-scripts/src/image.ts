/**
 * The host's own check of an image a script output. Providers reject a whole request over one bad
 * image, and the image is stored and replayed with the conversation, so the bytes decide what it
 * is — never the type the script claimed, nor a check the script's VM ran.
 */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u

/** The leading bytes of each format a model accepts inline. */
const SIGNATURES: readonly { mimeType: string; matches: (bytes: Uint8Array) => boolean }[] = [
  {
    mimeType: 'image/png',
    matches: (b) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => b[index] === byte),
  },
  { mimeType: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: 'image/gif',
    matches: (b) => ascii(b, 0, 4) === 'GIF8' && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    mimeType: 'image/webp',
    matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
]

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

/** The image's real type, or undefined when `data` is not well-formed base64 of a known format. */
export function sniffImage(data: string): string | undefined {
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) return undefined
  const head = Buffer.from(data.slice(0, 16), 'base64')
  return SIGNATURES.find((signature) => signature.matches(head))?.mimeType
}
