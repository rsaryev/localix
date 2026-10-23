import {
  MINI_APP_ICON_MAX_BYTES,
  mediaExtension,
  readImageInfo,
  svgHoldsActiveContent,
} from '@localixai/mini-app-sdk/manifest-media'

import { NotFoundError } from '../../lib/domain-errors'
import { readAppFile } from './app-files'
import type { StoreMediaFile } from './store-media'

/** The part of an installed mini app its icon needs. */
export interface MiniAppIconSource {
  name: string
  dir: string
  manifest: { icon?: string; version?: string } | null
}

/**
 * Where the host serves an installed mini app's own icon — the file its manifest names — for the
 * rail and the Mac app it can become. The version busts a cache when an update brings a new one.
 */
export function miniAppIconUrl(app: MiniAppIconSource): string | undefined {
  if (typeof app.manifest?.icon !== 'string') return undefined
  const version = app.manifest.version ? `?v=${encodeURIComponent(app.manifest.version)}` : ''
  return `/rpc/mini-apps/${encodeURIComponent(app.name)}/icon${version}`
}

/** The icon's bytes, read inside the app's folder and checked to be the picture it claims. */
export async function readMiniAppIcon(app: MiniAppIconSource): Promise<StoreMediaFile> {
  const missing = () => new NotFoundError('mini_app_icon_not_found', `"${app.name}" has no icon`)
  const path = app.manifest?.icon
  if (typeof path !== 'string') throw missing()
  const bytes = await readAppFile(app.dir, path, { maxBytes: MINI_APP_ICON_MAX_BYTES })
  const ext = mediaExtension(path)
  const info = bytes ? readImageInfo(bytes, ext) : null
  if (!bytes || !info || (ext === 'svg' && svgHoldsActiveContent(bytes))) throw missing()
  return { bytes, type: info.type }
}
