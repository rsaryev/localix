// An extension folder's manifests, as build and packaging scripts read them (no TypeScript loader).
// A folder holds a mini app (`mini-app.json`) or a plugin in the Claude Code format
// (`.claude-plugin/plugin.json`), never both (docs/internals/plugins-and-mini-apps.md). The runtime
// composes them in `apps/api/src/features/plugins/layout/compose.ts`; these scripts need only a few
// Localix fields, which live in the mini app.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MINI_APP_MANIFEST = 'mini-app.json'
export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json'

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** True when `dir` holds an extension manifest of any kind. */
export function hasExtensionManifest(dir) {
  return [MINI_APP_MANIFEST, PLUGIN_MANIFEST].some((file) => existsSync(join(dir, file)))
}

/**
 * True when `dir` is a Claude Code plugin and nothing else: its only manifest is
 * `.claude-plugin/plugin.json`. Such a folder under `plugins/` is a built-in plugin
 * (`stage-builtin-plugins.mjs`), never a mini app to stage.
 */
export function isClaudeCodePluginOnly(dir) {
  return existsSync(join(dir, PLUGIN_MANIFEST)) && localixManifestFile(dir) === null
}

/**
 * The file that carries the Localix layer (`private`, `fileAssociations`, the backend): the mini
 * app manifest; null for a plain Claude Code plugin.
 */
export function localixManifestFile(dir) {
  const file = join(dir, MINI_APP_MANIFEST)
  return existsSync(file) ? file : null
}

/**
 * The fields packaging reads: the mini app's manifest, else the plugin's identity. Throws with the
 * file's name on invalid JSON.
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
  return existsSync(join(dir, MINI_APP_MANIFEST))
    ? parse(MINI_APP_MANIFEST)
    : parse(PLUGIN_MANIFEST)
}
