import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { envString } from '../../lib/env'
import { resolveBundledRoot } from '../../lib/bundled-root'
import { MINI_APP_KIT_DIR_NAME } from './kit-layout'

/**
 * Where the running app's mini app kit is. `LOCALIX_MINI_APP_KIT_DIR` is the test override.
 * Development stages the kit beside its staged mini apps and names only that folder
 * (`LOCALIX_BUNDLED_MINI_APPS_DIR`), so a kit next to it wins. A release ships no mini apps and
 * finds its kit beside the API (`resources/mini-app-kit`), the way every staged resource is found
 * (`resolveBundledRoot`); the source fallback is only the repository's own layout.
 */
export function miniAppKitDirFrom(moduleUrl: string): string {
  const override = envString('LOCALIX_MINI_APP_KIT_DIR')
  if (override) return override
  const stagedMiniApps = envString('LOCALIX_BUNDLED_MINI_APPS_DIR')
  const besideStaged = stagedMiniApps && join(dirname(stagedMiniApps), MINI_APP_KIT_DIR_NAME)
  if (besideStaged && existsSync(besideStaged)) return besideStaged
  return resolveBundledRoot({
    moduleUrl,
    dirName: MINI_APP_KIT_DIR_NAME,
    sourceRelative: `../../../../../${MINI_APP_KIT_DIR_NAME}`,
  })
}

export function miniAppKitDir(): string {
  return miniAppKitDirFrom(import.meta.url)
}
