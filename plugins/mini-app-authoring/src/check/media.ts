import type { Kit, MiniAppMediaFields } from '../kit/kit'
import { readAppFile } from '../lib/app-file'

/** The media fields as written, whatever else the manifest holds; the schema step judges the rest. */
export function mediaFields(manifest: Record<string, unknown>): MiniAppMediaFields {
  const screenshots = Array.isArray(manifest.screenshots)
    ? manifest.screenshots.flatMap((shot) =>
        shot && typeof shot === 'object' && typeof shot.path === 'string'
          ? [{ path: shot.path as string }]
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
 * The store media step: the icon every published mini app needs and the screenshots it declares,
 * read from its own folder by Localix's rules (`tools.manifest.checkMedia`). A problem here does not
 * hold back a build — the app runs without an icon — but packing it for a catalog refuses one.
 */
export async function checkMiniAppStoreMedia(
  kit: Kit,
  miniAppDir: string,
  manifest: Record<string, unknown>,
): Promise<string[]> {
  return kit.tools.manifest.checkMedia(
    mediaFields(manifest),
    (path) => readAppFile(miniAppDir, path),
    {
      requireIcon: true,
    },
  )
}
