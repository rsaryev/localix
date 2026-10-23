import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { checkMiniAppMedia, type MiniAppMediaFields } from '@localixai/mini-app-sdk/manifest-media'

import { readAppFile } from '../app-files'

/** The media fields as written, whatever else the manifest holds; the schema step judges the rest. */
function mediaFields(manifest: Record<string, unknown>): MiniAppMediaFields {
  const screenshots = Array.isArray(manifest.screenshots)
    ? manifest.screenshots.flatMap((shot) =>
        shot && typeof shot === 'object' && typeof shot.path === 'string'
          ? [{ path: shot.path }]
          : [],
      )
    : []
  return {
    ...(typeof manifest.icon === 'string' ? { icon: manifest.icon } : {}),
    screenshots,
    ...(typeof manifest.homepage === 'string' ? { homepage: manifest.homepage } : {}),
  }
}

/**
 * The store media step of the authoring check: the icon every published mini app needs and the
 * screenshots it declares, read from its own folder (`manifest-media` has the rules). A problem
 * here is reported like any failed step but does not hold back the build: the app runs here
 * without an icon; only packing it for a catalog refuses one.
 */
export async function checkMiniAppStoreMedia(miniAppDir: string): Promise<string[]> {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await fs.readFile(join(miniAppDir, MINI_APP_MANIFEST_FILE), 'utf8'))
  } catch {
    return [`${MINI_APP_MANIFEST_FILE} could not be read`]
  }
  return checkMiniAppMedia(mediaFields(manifest), (path) => readAppFile(miniAppDir, path), {
    requireIcon: true,
  })
}
