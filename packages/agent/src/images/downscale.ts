/// <reference types="node" />
// `Buffer` is this module's only Node global. The full `jimp` barrel used to pull Node's types in
// through its codecs' declarations; the four @jimp packages imported below do not.
/**
 * Image downscaling for vision token savings. Vision models price an image by its
 * DIMENSIONS (Anthropic ~ w·h/750 tokens; OpenAI/OpenRouter by 512px tiles), so
 * capping the long edge is the lever — not re-compressing bytes. We cap at 1568px,
 * the size beyond which Anthropic downscales internally anyway, so it's near-lossless
 * for the model while cutting tokens on the large screenshots agents routinely attach.
 *
 * Pure + async (jimp decode/resize/encode). Resizes png/jpeg only — webp/gif are
 * passed through untouched (jimp can't round-trip them safely). Any failure returns
 * the original unchanged: downscaling is an optimization, never a correctness risk.
 */
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import * as resize from '@jimp/plugin-resize'
import type { ImageContent } from '../types'
import { browserHash } from '../utils/hash'

// Only what downscaling uses: the `jimp` barrel registers all 18 plugins and 6 codecs at module
// scope, so nothing tree-shakes, and each @jimp plugin carries its own nested zod 3 — 2.7 MB of
// the API bundle for one resize. Codecs are the two in RESIZABLE; `scaleToFit` is plugin-resize's.
const Jimp = createJimp({ formats: [png, jpeg], plugins: [resize.methods] })

export type ImageMediaType = ImageContent['mediaType']

export interface DownscaleResult {
  /** base64 (no data: prefix) — resized when `resized`, else the original. */
  data: string
  mediaType: ImageMediaType
  resized: boolean
  beforeBytes: number
  afterBytes: number
  width: number
  height: number
}

export interface DownscaleOptions {
  /** Cap the longer edge to this many pixels. Default 1568 (Anthropic's effective max). */
  maxEdge?: number
}

// jimp round-trips these reliably; others (webp, animated gif) are left as-is.
const RESIZABLE: ReadonlySet<ImageMediaType> = new Set<ImageMediaType>(['image/png', 'image/jpeg'])

const approxBytes = (base64: string): number => Math.floor((base64.length * 3) / 4)

export async function downscaleImage(
  base64: string,
  mediaType: ImageMediaType,
  opts: DownscaleOptions = {},
): Promise<DownscaleResult> {
  const maxEdge = opts.maxEdge ?? 1568
  const beforeBytes = approxBytes(base64)
  const passthrough = (width = 0, height = 0): DownscaleResult => ({
    data: base64,
    mediaType,
    resized: false,
    beforeBytes,
    afterBytes: beforeBytes,
    width,
    height,
  })
  if (!RESIZABLE.has(mediaType)) return passthrough()

  try {
    const image = await Jimp.read(Buffer.from(base64, 'base64'))
    const { width, height } = image
    if (Math.max(width, height) <= maxEdge) return passthrough(width, height)

    // Fit within a maxEdge×maxEdge box, preserving aspect ratio.
    image.scaleToFit({ w: maxEdge, h: maxEdge })
    // RESIZABLE guarantees png/jpeg here; concrete literals select jimp's right overload
    // (the `quality` option is jpeg-only).
    const outBuffer =
      mediaType === 'image/jpeg'
        ? await image.getBuffer('image/jpeg', { quality: 80 })
        : await image.getBuffer('image/png')
    const out = outBuffer.toString('base64')
    return {
      data: out,
      mediaType,
      resized: true,
      beforeBytes,
      afterBytes: outBuffer.length,
      width: image.width,
      height: image.height,
    }
  } catch {
    return passthrough()
  }
}

// The wire is rebuilt every run, so the same attached image would be re-decoded each
// turn (jimp decode is ~hundreds of ms). A small bounded cache keyed by a content
// hash makes turns after the first a hit. Bounded so memory stays flat.
const CACHE_MAX = 64
const resizeCache = new Map<string, DownscaleResult>()
// Key on a real content hash, NOT length+head/tail slices: two distinct same-size
// PNG screenshots share an identical signature+IHDR head and IEND tail, so a
// head/tail+length key collides and would silently serve the FIRST image's bytes
// for the SECOND. browserHash (64-bit FNV over the full base64) is ~ms — far cheaper
// than the jimp decode it guards — and collision-safe for a 64-entry cache.
const fingerprint = (base64: string, maxEdge: number): string =>
  `${maxEdge}:${base64.length}:${browserHash(base64)}`

/** {@link downscaleImage} with a bounded result cache — use on the per-run wire path. */
export async function downscaleImageCached(
  base64: string,
  mediaType: ImageMediaType,
  opts: DownscaleOptions = {},
): Promise<DownscaleResult> {
  const key = fingerprint(base64, opts.maxEdge ?? 1568)
  const hit = resizeCache.get(key)
  if (hit) return hit
  const result = await downscaleImage(base64, mediaType, opts)
  if (resizeCache.size >= CACHE_MAX) resizeCache.delete(resizeCache.keys().next().value!)
  resizeCache.set(key, result)
  return result
}
