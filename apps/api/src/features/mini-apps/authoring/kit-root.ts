import { dirname, join } from 'node:path'

import { envString } from '../../../lib/env'
import { bundledMiniAppsRoot } from '../discovery'
import { PLUGIN_KIT_DIR_NAME } from './kit-layout'

/**
 * Where the running app's plugin kit is. It ships beside the staged plugins, so it is found the
 * same way they are: the packaged `resources/plugins` has `resources/plugin-kit` next to it, and
 * the dev staging root has its own. `LOCALIX_PLUGIN_KIT_DIR` is the test and launcher override.
 */
export function miniAppKitDir(): string {
  return (
    envString('LOCALIX_PLUGIN_KIT_DIR') ?? join(dirname(bundledMiniAppsRoot()), PLUGIN_KIT_DIR_NAME)
  )
}
