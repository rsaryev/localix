// An extension folder's manifests, as build and packaging scripts read them (no TypeScript loader).
// A folder holds a plugin in the Claude Code format (`.claude-plugin/plugin.json`), a mini app
// (`.localix-app/app.json`), both, or a legacy root `plugin.json`
// (docs/internals/plugins-and-mini-apps.md). The runtime composes them in
// `apps/api/src/features/plugins/layout/compose.ts`; these scripts need only a few Localix fields,
// which live in the mini app (or the legacy manifest).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json'
export const MINI_APP_MANIFEST = '.localix-app/app.json'
export const LEGACY_MANIFEST = 'plugin.json'

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** True when `dir` holds an extension manifest of any kind. */
export function hasExtensionManifest(dir) {
  return [PLUGIN_MANIFEST, MINI_APP_MANIFEST, LEGACY_MANIFEST].some((file) =>
    existsSync(join(dir, file)),
  )
}

/**
 * The file that carries the Localix layer (`private`, `fileAssociations`, the backend): the mini
 * app manifest, else a legacy `plugin.json`; null for a plain Claude Code plugin.
 */
export function localixManifestFile(dir) {
  for (const file of [MINI_APP_MANIFEST, LEGACY_MANIFEST]) {
    if (existsSync(join(dir, file))) return join(dir, file)
  }
  return null
}

/** The manifest field naming the native backend entry: `backend` in a mini app, `tools` before. */
export function backendField(file) {
  return file.endsWith(MINI_APP_MANIFEST) ? 'backend' : 'tools'
}

/**
 * The fields packaging reads, merged the way the runtime merges them: the plugin's identity, the
 * mini app's Localix fields. Throws with the file's name on invalid JSON.
 */
export function readExtensionManifest(dir) {
  const parse = (file) => {
    const path = join(dir, file)
    if (!existsSync(path)) return {}
    try {
      return read(path)
    } catch (error) {
      throw new Error(`${path} is not valid JSON: ${error.message}`)
    }
  }
  const plugin = parse(PLUGIN_MANIFEST)
  const app = parse(MINI_APP_MANIFEST)
  const legacy =
    existsSync(join(dir, PLUGIN_MANIFEST)) || existsSync(join(dir, MINI_APP_MANIFEST))
      ? {}
      : parse(LEGACY_MANIFEST)
  const merged = { ...legacy, ...plugin, ...app }
  if (app.backend !== undefined) merged.tools = app.backend
  if (plugin.version !== undefined) merged.version = plugin.version
  return merged
}
