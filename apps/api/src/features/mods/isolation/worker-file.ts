import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The worker a mod instance runs in, as a BUNDLED host carries it beside its entry bundle; the
 * desktop build writes it (`apps/desktop-tauri/scripts/prepare-sidecar.mjs`, which bundles
 * `worker-main.ts`). Imports nothing of the feature, so a build script can read the name.
 */
export const MOD_WORKER_FILE = 'mod-worker.js'

/** The bundled worker beside `dir` when there is one, else this source tree's. */
export function modWorkerUrl(dir?: string): URL {
  const bundled = dir === undefined ? undefined : join(dir, MOD_WORKER_FILE)
  if (bundled && existsSync(bundled)) return pathToFileURL(bundled)
  return new URL('./worker-main.ts', import.meta.url)
}
