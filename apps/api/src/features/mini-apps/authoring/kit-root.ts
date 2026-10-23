import { dirname, join } from 'node:path'

import { envString } from '../../../lib/env'
import { bundledMiniAppsRoot } from '../discovery'
import { MINI_APP_KIT_DIR_NAME } from './kit-layout'

/**
 * Where the running app's mini app kit is. It ships beside the staged mini apps, so it is found the
 * same way they are: the packaged `resources/mini-apps` has `resources/mini-app-kit` next to it,
 * and the dev staging root has its own. `LOCALIX_MINI_APP_KIT_DIR` is the test and launcher
 * override.
 */
export function miniAppKitDir(): string {
  return (
    envString('LOCALIX_MINI_APP_KIT_DIR') ??
    join(dirname(bundledMiniAppsRoot()), MINI_APP_KIT_DIR_NAME)
  )
}
