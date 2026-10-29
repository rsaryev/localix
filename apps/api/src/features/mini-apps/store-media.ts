import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MINI_APP_ICON_MAX_BYTES,
  MINI_APP_ICON_TYPES,
  MINI_APP_SCREENSHOT_MAX_BYTES,
  MINI_APP_SCREENSHOT_TYPES,
  readImageInfo,
  svgHoldsActiveContent,
} from '@localixai/mini-app-sdk/manifest-media'

import { NotFoundError, UnavailableError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { downloadPinned, isDownloaded } from '../../lib/pinned-download'
import type { Offer, OfferFile } from './store-offers'

/**
 * The files of an app's store page — its icon, screenshots and README — as the host serves them.
 * A catalog's are fetched once, refused unless their size and sha256 match the catalog's pin, and
 * kept under the Localix cache by hash. The bytes are checked to be the kind of file they claim
 * before they leave, so a catalog cannot serve a page as an "image".
 */

export type StoreMediaKind = 'icon' | 'screenshot' | 'readme'

export interface StoreMediaFile {
  bytes: Uint8Array
  type: string
}

const README_MAX_BYTES = 512 * 1024
const CAPS: Record<StoreMediaKind, number> = {
  icon: MINI_APP_ICON_MAX_BYTES,
  screenshot: MINI_APP_SCREENSHOT_MAX_BYTES,
  readme: README_MAX_BYTES,
}
const TYPES: Record<StoreMediaKind, Readonly<Record<string, string>>> = {
  icon: MINI_APP_ICON_TYPES,
  screenshot: MINI_APP_SCREENSHOT_TYPES,
  readme: { md: 'text/markdown' },
}

/** Where the host serves one of an app's files. A catalog's carries its hash, so it may be cached. */
export function storeMediaUrl(
  name: string,
  kind: Exclude<StoreMediaKind, 'readme'>,
  file: OfferFile,
  index?: number,
): string {
  const path = `/rpc/mini-apps/store/media/${encodeURIComponent(name)}/${kind}${index === undefined ? '' : `/${index}`}`
  return `${path}?v=${file.sha256.slice(0, 12)}`
}

/** The extension a file of this kind is read as: its type's. */
function extensionOf(kind: StoreMediaKind, file: OfferFile): string | undefined {
  const types = TYPES[kind]
  return Object.keys(types).find((ext) => types[ext] === file.type)
}

export function createStoreMediaReader(deps: { cacheDir: string; fetchImpl?: typeof fetch }) {
  const inflight = new Map<string, Promise<unknown>>()

  async function fetchPinned(file: OfferFile): Promise<Uint8Array> {
    const dest = join(deps.cacheDir, file.sha256)
    const pinned = { name: 'store media', url: file.url, bytes: file.bytes, sha256: file.sha256 }
    if (!(await isDownloaded(pinned, dest))) {
      const running = inflight.get(file.sha256) ?? downloadPinned(pinned, dest, deps)
      inflight.set(file.sha256, running)
      try {
        await running
      } finally {
        inflight.delete(file.sha256)
      }
    }
    return new Uint8Array(await readFile(dest))
  }

  /** A catalog's pinned image read before any offer exists (a catalog's preview). */
  async function catalogImage(file: OfferFile): Promise<StoreMediaFile | null> {
    const ext = extensionOf('icon', file)
    if (!ext || file.bytes > CAPS.icon) return null
    const bytes = await fetchPinned(file).catch(() => null)
    const info = bytes ? readImageInfo(bytes, ext) : null
    if (!bytes || !info || (ext === 'svg' && svgHoldsActiveContent(bytes))) return null
    return { bytes, type: info.type }
  }

  async function read(offer: Offer, kind: StoreMediaKind, index = 0): Promise<StoreMediaFile> {
    const file =
      kind === 'icon'
        ? offer.store.icon
        : kind === 'readme'
          ? offer.store.readme
          : offer.store.screenshots[index]
    const missing = () =>
      new NotFoundError('mini_app_media_not_found', `"${offer.name}" has no ${kind} ${index + 1}`)
    if (!file) throw missing()
    const ext = extensionOf(kind, file)
    if (!ext) throw missing()
    if (file.bytes > CAPS[kind]) throw missing()
    let bytes: Uint8Array
    try {
      bytes = await fetchPinned(file)
    } catch (error) {
      throw new UnavailableError('mini_app_media_unavailable', errorMessage(error))
    }
    if (kind === 'readme') return { bytes, type: 'text/markdown; charset=utf-8' }
    const info = readImageInfo(bytes, ext)
    if (!info || (ext === 'svg' && svgHoldsActiveContent(bytes))) throw missing()
    return { bytes, type: info.type }
  }

  return { read, catalogImage }
}

export type StoreMediaReader = ReturnType<typeof createStoreMediaReader>
