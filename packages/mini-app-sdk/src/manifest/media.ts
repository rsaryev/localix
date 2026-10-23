/**
 * ── STORE MEDIA ───────────────────────────────────────────────────────────────
 * What a mini app shows in the store: its icon and its screenshots, named in `mini-app.json` and
 * shipped beside it. One statement of the rules, read by the authoring check (`mini_app_build`,
 * `/mini-app reload`), the pack step that refuses to publish an app without a valid icon, and the
 * host that serves the files. Pure: the caller hands in a reader, so the same check runs on a
 * folder, an archive or a test's map.
 *
 * Format and reasons: `docs/extending/mini-app-publishing.md`, "Icon and screenshots".
 */

export const MINI_APP_ICON_MAX_BYTES = 256 * 1024
/** A raster icon is drawn up to 1024 points in the Dock; below 512 it blurs. */
export const MINI_APP_ICON_MIN_PIXELS = 512
export const MINI_APP_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024
import { isAppRelativePath } from './primitives'

export {
  isAppRelativePath,
  MINI_APP_SCREENSHOTS_MAX,
  MINI_APP_TAG_RE,
  MINI_APP_TAGS_MAX,
} from './primitives'

/** Extension → the `Content-Type` the host serves it with. */
export const MINI_APP_ICON_TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
}
export const MINI_APP_SCREENSHOT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** The lower-cased extension without its dot; empty when there is none. */
export function mediaExtension(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export interface ImageInfo {
  type: string
  width: number
  height: number
}

const be16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!
const le16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8)
const le24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)
const ascii = (b: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...b.subarray(at, at + length))

function pngSize(b: Uint8Array): [number, number] | null {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 24 || magic.some((byte, i) => b[i] !== byte) || ascii(b, 12, 4) !== 'IHDR')
    return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function jpegSize(b: Uint8Array): [number, number] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]!
    // Start-of-frame markers carry the size; C4 (huffman), C8 and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return [be16(b, at + 7), be16(b, at + 5)]
    at += 2 + be16(b, at + 2)
  }
  return null
}

function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') return [le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff]
  if (chunk === 'VP8L')
    return [
      1 + (((b[22]! & 0x3f) << 8) | b[21]!),
      1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
    ]
  if (chunk === 'VP8X') return [1 + le24(b, 24), 1 + le24(b, 27)]
  return null
}

function icoSize(b: Uint8Array): [number, number] | null {
  if (b.length < 22 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return null
  let best: [number, number] | null = null
  for (let i = 0; i < le16(b, 4) && 6 + i * 16 + 16 <= b.length; i++) {
    // A stored 0 means 256, the largest an ICO entry can say.
    const width = b[6 + i * 16] || 256
    const height = b[7 + i * 16] || 256
    if (!best || width > best[0]) best = [width, height]
  }
  return best
}

function svgSize(b: Uint8Array): [number, number] | null {
  const text = new TextDecoder().decode(b)
  const root = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!root) return null
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1]
  const box = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box?.length === 4 && box.every(Number.isFinite)) return [box[2]!, box[3]!]
  const width = Number.parseFloat(attr('width') ?? '')
  const height = Number.parseFloat(attr('height') ?? '')
  return Number.isFinite(width) && Number.isFinite(height) ? [width, height] : [0, 0]
}

const READERS: Record<string, (bytes: Uint8Array) => [number, number] | null> = {
  png: pngSize,
  jpg: jpegSize,
  jpeg: jpegSize,
  webp: webpSize,
  ico: icoSize,
  svg: svgSize,
}
const TYPES = { ...MINI_APP_ICON_TYPES, ...MINI_APP_SCREENSHOT_TYPES }

/**
 * What an image is, read from its bytes for the kind its extension names, or null when the bytes
 * are not that kind. Only headers are read; nothing is decoded.
 */
export function readImageInfo(bytes: Uint8Array, extension: string): ImageInfo | null {
  const size = READERS[extension]?.(bytes)
  const type = TYPES[extension]
  return size && type ? { type, width: size[0], height: size[1] } : null
}

/** An SVG is shown as a picture only; one that carries script or foreign content is refused. */
export function svgHoldsActiveContent(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes)
  return /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/i.test(text)
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const extensions = (types: Readonly<Record<string, string>>) =>
  Object.keys(types)
    .map((ext) => `.${ext}`)
    .join(', ')
    .replace(/, ([^,]*)$/, ' or $1')

export interface MiniAppMediaFields {
  icon?: string
  screenshots?: readonly { path: string; caption?: string }[]
  homepage?: string
}

/** Reads one file of the app by its manifest path; null when it is not there. */
export type MiniAppFileReader = (path: string) => Promise<Uint8Array | null>

async function checkIcon(path: string, read: MiniAppFileReader): Promise<string | null> {
  const ext = mediaExtension(path)
  if (!MINI_APP_ICON_TYPES[ext])
    return `The icon ${path} is a .${ext || '?'}; use ${extensions(MINI_APP_ICON_TYPES)}`
  const bytes = isAppRelativePath(path) ? await read(path) : null
  if (!bytes) return `The icon ${path} is not in the mini app folder`
  if (bytes.byteLength > MINI_APP_ICON_MAX_BYTES)
    return `The icon ${path} is ${kb(bytes.byteLength)}; an icon may be at most ${MINI_APP_ICON_MAX_BYTES / 1024} KB`
  const info = readImageInfo(bytes, ext)
  if (!info) return `The icon ${path} is not a .${ext} file`
  if (ext === 'svg' && svgHoldsActiveContent(bytes))
    return `The icon ${path} holds a script; an icon is a picture only`
  if (info.width !== info.height || info.width <= 0)
    return `The icon ${path} is ${info.width}×${info.height}; an icon must be square`
  if ((ext === 'png' || ext === 'webp') && info.width < MINI_APP_ICON_MIN_PIXELS)
    return `The icon ${path} is ${info.width}×${info.height}; a .${ext} icon needs at least ${MINI_APP_ICON_MIN_PIXELS}×${MINI_APP_ICON_MIN_PIXELS}`
  return null
}

async function checkScreenshot(path: string, read: MiniAppFileReader): Promise<string | null> {
  const ext = mediaExtension(path)
  if (!MINI_APP_SCREENSHOT_TYPES[ext])
    return `The screenshot ${path} is a .${ext || '?'}; use ${extensions(MINI_APP_SCREENSHOT_TYPES)}`
  const bytes = isAppRelativePath(path) ? await read(path) : null
  if (!bytes) return `The screenshot ${path} is not in the mini app folder`
  if (bytes.byteLength > MINI_APP_SCREENSHOT_MAX_BYTES)
    return `The screenshot ${path} is ${mb(bytes.byteLength)}; a screenshot may be at most ${MINI_APP_SCREENSHOT_MAX_BYTES / 1024 / 1024} MB`
  if (!readImageInfo(bytes, ext)) return `The screenshot ${path} is not a .${ext} file`
  return null
}

/**
 * Every problem with the store media `mini-app.json` declares, each said as what to fix. With
 * `requireIcon` (packing, the authoring check), an app that names no icon is a problem too.
 */
export async function checkMiniAppMedia(
  manifest: MiniAppMediaFields,
  read: MiniAppFileReader,
  options: { requireIcon?: boolean } = {},
): Promise<string[]> {
  const problems: (string | null)[] = []
  if (manifest.icon) problems.push(await checkIcon(manifest.icon, read))
  else if (options.requireIcon)
    problems.push(
      `mini-app.json declares no "icon"; a published mini app needs one (an .svg, or a square .png of at least ${MINI_APP_ICON_MIN_PIXELS}×${MINI_APP_ICON_MIN_PIXELS})`,
    )
  for (const shot of manifest.screenshots ?? [])
    problems.push(await checkScreenshot(shot.path, read))
  if (manifest.homepage && !/^https:\/\/[^\s/]+/.test(manifest.homepage))
    problems.push(`The homepage ${manifest.homepage} is not an https:// address`)
  return problems.filter((problem): problem is string => problem !== null)
}
