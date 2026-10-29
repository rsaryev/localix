import { envString } from '../../lib/env'
import { resolveBundledRoot } from '../../lib/bundled-root'
import { MINI_APP_KIT_DIR_NAME } from './kit-layout'

/**
 * Where the running app's mini app kit is. Development and tests name it
 * (`LOCALIX_MINI_APP_KIT_DIR`: `scripts/dev-api.mjs` stages one per run). A release finds its kit
 * beside the API (`resources/mini-app-kit`), the way every staged resource is found
 * (`resolveBundledRoot`); the source fallback is only the repository's own layout.
 */
export function miniAppKitDirFrom(moduleUrl: string): string {
  const named = envString('LOCALIX_MINI_APP_KIT_DIR')
  if (named) return named
  return resolveBundledRoot({
    moduleUrl,
    dirName: MINI_APP_KIT_DIR_NAME,
    sourceRelative: `../../../../../${MINI_APP_KIT_DIR_NAME}`,
  })
}

export function miniAppKitDir(): string {
  return miniAppKitDirFrom(import.meta.url)
}
