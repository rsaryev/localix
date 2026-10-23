import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

/**
 * Where a mini app names its native backend: the `backend` field of its `mini-app.json`. The
 * build writes this pointer (`authoring/backend-build.ts`). A mini app reads nothing of the
 * Claude Code format (docs/internals/plugins-and-mini-apps.md), so no other manifest is looked at.
 */
export interface BackendPointer {
  path: string
  field: 'backend'
}

export async function backendPointer(dir: string): Promise<BackendPointer> {
  return { path: join(dir, MINI_APP_MANIFEST_FILE), field: 'backend' }
}

/** The manifest object at the pointer, or `{}` when it does not exist yet. */
export async function readPointerManifest(
  _dir: string,
  pointer: BackendPointer,
): Promise<Record<string, unknown>> {
  const text = await fs.readFile(pointer.path, 'utf8').catch(() => null)
  return text === null ? {} : (JSON.parse(text) as Record<string, unknown>)
}
