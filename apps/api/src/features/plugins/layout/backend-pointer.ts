import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_FILE } from '@localixai/claude-plugin'
import {
  LEGACY_MINI_APP_MANIFEST_FILE,
  MINI_APP_MANIFEST_FILE,
} from '@localixai/mini-app-sdk/app-manifest'
import { LEGACY_MANIFEST_FILE } from './read'

/**
 * Where an extension names its native backend: a mini app's `backend` (`mini-app.json`, or the
 * `.localix-app/app.json` of a decorated plugin), or a legacy manifest's `tools`. The build writes
 * this pointer (`authoring/backend-build.ts`); a folder with none of them gets a `mini-app.json`.
 */
export interface BackendPointer {
  path: string
  field: 'backend' | 'tools'
}

const exists = (path: string) =>
  fs.stat(path).then(
    () => true,
    () => false,
  )

export async function backendPointer(dir: string): Promise<BackendPointer> {
  const miniApp = join(dir, MINI_APP_MANIFEST_FILE)
  if (await exists(miniApp)) return { path: miniApp, field: 'backend' }
  const decorated = join(dir, LEGACY_MINI_APP_MANIFEST_FILE)
  if (await exists(decorated)) return { path: decorated, field: 'backend' }
  const legacy = join(dir, LEGACY_MANIFEST_FILE)
  if (!(await exists(join(dir, MANIFEST_FILE))) && (await exists(legacy)))
    return { path: legacy, field: 'tools' }
  return { path: miniApp, field: 'backend' }
}

/** The manifest object at the pointer: `{ name }` (from the plugin) when it does not exist yet. */
export async function readPointerManifest(
  dir: string,
  pointer: BackendPointer,
): Promise<Record<string, unknown>> {
  const text = await fs.readFile(pointer.path, 'utf8').catch(() => null)
  if (text !== null) return JSON.parse(text) as Record<string, unknown>
  const plugin = await fs
    .readFile(join(dir, MANIFEST_FILE), 'utf8')
    .then((raw) => JSON.parse(raw) as { name?: unknown })
    .catch(() => null)
  return typeof plugin?.name === 'string' ? { name: plugin.name } : {}
}
