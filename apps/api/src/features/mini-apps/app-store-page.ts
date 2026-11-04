import {
  MINI_APP_SCREENSHOT_MAX_BYTES,
  MINI_APP_SCREENSHOT_TYPES,
  mediaExtension,
  readImageInfo,
} from '@localixai/mini-app-sdk/manifest-media'

import { NotFoundError } from '../../lib/domain-errors'
import { readAppFile } from './app-files'
import type { StoreMediaFile } from './store-media'

/** The same cap a marketplace's README has on its store page. */
const README_MAX_BYTES = 512 * 1024

/** The part of an installed mini app its own store page needs. */
export interface MiniAppStorePageSource {
  name: string
  dir: string
  manifest: { version?: string; screenshots?: unknown } | null
}

function declaredScreenshots(app: MiniAppStorePageSource): { path: string; caption?: string }[] {
  const shots = app.manifest?.screenshots
  if (!Array.isArray(shots)) return []
  return shots.flatMap((shot) =>
    shot && typeof shot === 'object' && typeof shot.path === 'string'
      ? [
          {
            path: shot.path,
            ...(typeof shot.caption === 'string' ? { caption: shot.caption } : {}),
          },
        ]
      : [],
  )
}

/**
 * Where the host serves an installed mini app's screenshots — the files its manifest declares, in
 * order — for its own Store page. A marketplace's page has its own; one made or kept on this
 * computer had none, though they sat in its folder. The version busts a cache on an update.
 */
export function miniAppScreenshots(
  app: MiniAppStorePageSource,
): { url: string; caption?: string }[] {
  const version = app.manifest?.version ? `?v=${encodeURIComponent(app.manifest.version)}` : ''
  return declaredScreenshots(app).map((shot, index) => ({
    url: `/rpc/mini-apps/${encodeURIComponent(app.name)}/screenshot/${index}${version}`,
    ...(shot.caption ? { caption: shot.caption } : {}),
  }))
}

/** One screenshot's bytes, read inside the app's folder and checked to be the picture it claims. */
export async function readMiniAppScreenshot(
  app: MiniAppStorePageSource,
  index: number,
): Promise<StoreMediaFile> {
  const missing = () =>
    new NotFoundError('mini_app_screenshot_not_found', `"${app.name}" has no screenshot ${index}`)
  const shot = declaredScreenshots(app)[index]
  if (!shot) throw missing()
  const ext = mediaExtension(shot.path)
  if (!MINI_APP_SCREENSHOT_TYPES[ext]) throw missing()
  const bytes = await readAppFile(app.dir, shot.path, { maxBytes: MINI_APP_SCREENSHOT_MAX_BYTES })
  const info = bytes ? readImageInfo(bytes, ext) : null
  if (!bytes || !info) throw missing()
  return { bytes, type: info.type }
}

/** The README in the app's folder, as Markdown, or null when it has none. */
export async function readMiniAppReadme(app: MiniAppStorePageSource): Promise<string | null> {
  const bytes = await readAppFile(app.dir, 'README.md', { maxBytes: README_MAX_BYTES })
  return bytes ? new TextDecoder().decode(bytes) : null
}
