/**
 * `read` on an image: the file goes in front of the model as a native image part.
 *
 * The bytes travel as base64 over `env.exec`, so the same path works on the local, ssh and
 * docker backends without a binary-read primitive in the environment interface. A large PNG or
 * JPEG is downscaled to the long edge vision models price by, and the model is TOLD it was
 * resized — otherwise it measures a 1568px screenshot and reports pixel positions for a
 * 4000px one. A model that cannot read images gets a text answer instead of the tool being
 * withheld: `read` is how it reads everything else.
 */
import path from 'node:path'
import { formatSize, type ImageContent } from '@localixai/agent'
import { downscaleImage } from '@localixai/agent/images/downscale'
import { type ExecutionEnvironment, shellQuote } from '../environment'
import { formatDimensions, sniffImage, type ImageSniff } from './read-image-sniff'

/** Largest image file `read` loads (the workspace viewer's inline image cap). */
export const MAX_IMAGE_FILE_BYTES = 10_000_000
/** Largest image part sent after resizing; providers refuse bigger tool-result images. */
export const MAX_IMAGE_PART_BYTES = 5_000_000
/** Long-edge cap: the size beyond which vision models downscale internally anyway. */
export const IMAGE_MAX_EDGE = 1568

export type ImageFileBytes =
  | { kind: 'ok'; data: string; bytes: number }
  | { kind: 'too-big'; bytes: number }
  | { kind: 'unreadable' }

/**
 * Size first, in the SAME round trip, so an oversize file is refused before its bytes are
 * pulled into memory. `uncapped`: the default stdout cap keeps only the TAIL, which drops the
 * leading bytes and yields undecodable base64.
 */
export async function readImageBytes(
  env: ExecutionEnvironment,
  targetPath: string,
  signal?: AbortSignal,
): Promise<ImageFileBytes> {
  const q = shellQuote(targetPath)
  try {
    const res = await env.exec(
      `n=$(wc -c < ${q}) || exit 1; ` +
        `if [ "$n" -gt ${MAX_IMAGE_FILE_BYTES} ]; then printf 'TOOBIG %s' "$n"; ` +
        `else printf 'OK %s\\n' "$n"; base64 < ${q} | tr -d '\\n'; fi`,
      { uncapped: true, signal },
    )
    if (res.exitCode !== 0) return { kind: 'unreadable' }
    const newline = res.stdout.indexOf('\n')
    const header = newline >= 0 ? res.stdout.slice(0, newline) : res.stdout
    // BSD `wc -c` pads its count, so split on a run of whitespace.
    const bytes = Number(header.trim().split(/\s+/)[1])
    if (header.startsWith('TOOBIG')) return { kind: 'too-big', bytes }
    const data = res.stdout.slice(newline + 1).replace(/\s+/g, '')
    return header.startsWith('OK') && data ? { kind: 'ok', data, bytes } : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

/** The first bytes of a file, sniffed — how a misnamed image is recognised. */
export async function sniffImageFile(
  env: ExecutionEnvironment,
  targetPath: string,
  signal?: AbortSignal,
): Promise<ImageSniff | undefined> {
  try {
    const res = await env.exec(`head -c 64 < ${shellQuote(targetPath)} | base64 | tr -d '\\n'`, {
      signal,
    })
    return res.exitCode === 0 ? sniffImage(Buffer.from(res.stdout.trim(), 'base64')) : undefined
  } catch {
    return undefined
  }
}

export interface PreparedImage {
  text: string
  /** Absent when the model cannot see it, or it is too large to send. */
  image?: ImageContent
  sniff: ImageSniff
  isError?: true
}

const FORMAT_LABEL: Record<ImageContent['mediaType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
}

/**
 * The model-facing answer for an image file, or undefined when the bytes are not an image at
 * all (a text file named `.png` is read as text).
 */
export async function prepareImage(
  targetPath: string,
  data: string,
  bytes: number,
  canSeeImages: boolean,
): Promise<PreparedImage | undefined> {
  const sniff = sniffImage(Buffer.from(data, 'base64'))
  if (!sniff) return undefined
  const name = path.basename(targetPath)
  const facts = [FORMAT_LABEL[sniff.mediaType], formatDimensions(sniff.width, sniff.height)]
    .concat(formatSize(bytes))
    .filter(Boolean)
    .join(', ')
  if (!canSeeImages) {
    return {
      sniff,
      text: `${name} is an image (${facts}). The current model cannot view images, so its pixels are not shown; ask the user to describe it or switch to a vision model if its content matters.`,
    }
  }
  const scaled = await downscaleImage(data, sniff.mediaType, { maxEdge: IMAGE_MAX_EDGE })
  if (scaled.afterBytes > MAX_IMAGE_PART_BYTES) {
    return {
      sniff,
      isError: true,
      text: `${name} (${facts}) is too large to show even after resizing (limit ${formatSize(MAX_IMAGE_PART_BYTES)}). Convert or crop it with \`Bash\` first, e.g. to a smaller PNG or JPEG.`,
    }
  }
  const before = formatDimensions(sniff.width, sniff.height)
  const after = formatDimensions(scaled.width, scaled.height)
  const resized = scaled.resized
    ? ` It was resized from ${before ?? 'its original size'} to ${after} to fit the ${IMAGE_MAX_EDGE}px limit; scale coordinates you read from it back to the original.`
    : ''
  return {
    sniff,
    text: `Image ${name} (${facts}) is attached below.${resized}`,
    image: { type: 'image', mediaType: scaled.mediaType, data: scaled.data },
  }
}
