import { pluginManifestSchema, type PluginManifest } from './contracts'
import type { ComposedManifest } from './layout/compose'

/** The result of parsing a plugin's (optional) manifest into the host's runtime shape. */
export interface ParsedManifestFile {
  manifest: PluginManifest
  /** The composed manifest as parsed — undefined when the plugin has none. */
  rawManifest?: Record<string, unknown>
  /** Why the manifest cannot load: the plugin surfaces with this error and loads nothing. */
  error?: string
}

/**
 * Parse a composed runtime manifest (`layout/compose.ts`) with the host schema. The manifest is
 * OPTIONAL (Claude Code parity): a folder with none is a plugin named after `fallbackName` with
 * default version/description. Claude Code's own rules already ran, so a failure here is a name
 * the host cannot key a plugin by.
 */
export function parseComposedManifest(
  composed: ComposedManifest,
  fallbackName: string,
): ParsedManifestFile {
  const manifest: PluginManifest = { name: fallbackName, version: '0.0.0', description: '' }
  if (!composed.raw) return { manifest, ...(composed.error ? { error: composed.error } : {}) }
  const rawManifest = { ...composed.raw }
  const parsed = pluginManifestSchema.safeParse(composed.raw)
  if (parsed.success) return { manifest: parsed.data, rawManifest }
  const detail = parsed.error.issues
    .map((found) =>
      found.path.length ? `${found.path.join('.')}: ${found.message}` : found.message,
    )
    .join('; ')
  return { manifest, rawManifest, error: `Invalid manifest: ${detail}` }
}
