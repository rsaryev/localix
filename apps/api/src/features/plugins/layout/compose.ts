import {
  MANIFEST_FILE,
  parseClaudePluginManifest,
  type PluginIssue,
} from '@localixai/claude-plugin'
import { fromClaudePlugin } from './claude-code'

/**
 * A plugin folder read exactly as Claude Code reads it: `.claude-plugin/plugin.json`, or no
 * manifest at all (a plugin named after its folder). A root `plugin.json` is not Claude Code's
 * manifest and is not read; a folder holding a `.localix-mini-app/mini-app.json` is a mini app, never a plugin
 * (rule X2, `docs/internals/plugins-and-mini-apps.md`).
 */

/** A manifest file as read: its parsed JSON, or why it could not be read. */
export type ManifestFile = { file: string } & ({ json: unknown } | { readError: string })

export interface ManifestFiles {
  /** `.claude-plugin/plugin.json` */
  plugin?: ManifestFile
  /** A root `plugin.json` (an earlier Localix wrote one; Claude Code ignores it). */
  root?: ManifestFile
  /** The folder holds a `.localix-mini-app/mini-app.json`. */
  miniApp?: true
}

export interface ComposedManifest {
  /** The runtime manifest, before the host schema parses it; null without one (see `error`). */
  raw: Record<string, unknown> | null
  /** What Claude Code's own rules found: warnings load, errors name what did not. */
  issues: PluginIssue[]
  /** Why nothing loads, for the plugin's error line. */
  error?: string
}

export function composeManifest(files: ManifestFiles, folderName: string): ComposedManifest {
  if (files.miniApp)
    return {
      raw: null,
      issues: [],
      error:
        'This folder is a mini app (.localix-mini-app/mini-app.json), not a plugin: add it from the Store',
    }
  const issues: PluginIssue[] = []
  if (files.root && !isImportArtifact(files.root))
    issues.push({
      severity: 'warning',
      path: 'plugin.json',
      message: `plugin.json is not read: Claude Code reads ${MANIFEST_FILE}`,
    })
  if (!files.plugin) return { raw: null, issues }
  if ('readError' in files.plugin) return { raw: null, issues, error: files.plugin.readError }
  const parsed = parseClaudePluginManifest(files.plugin.json, { fallbackName: folderName })
  issues.push(...parsed.issues.map((found) => at(MANIFEST_FILE, found)))
  if (!parsed.manifest) return { raw: null, issues, error: firstError(parsed.issues) }
  return { raw: fromClaudePlugin(parsed.manifest), issues }
}

/** A root `plugin.json` an earlier Localix wrote beside a Claude Code plugin it imported. */
function isImportArtifact(file: ManifestFile): boolean {
  if (!('json' in file)) return false
  const origin = (file.json as { origin?: { format?: unknown } } | null)?.origin
  return origin?.format === 'claude-code'
}

const at = (file: string, found: PluginIssue): PluginIssue => ({
  ...found,
  path: `${file}#${found.path}`,
})

function firstError(found: readonly PluginIssue[]): string {
  const error = found.find((entry) => entry.severity === 'error')
  return `Invalid ${MANIFEST_FILE}: ${error?.message ?? 'the manifest cannot load'}`
}
