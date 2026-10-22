import {
  MANIFEST_FILE,
  parseClaudePluginManifest,
  type PluginIssue,
} from '@localixai/claude-plugin'
import {
  MINI_APP_MANIFEST_FILE,
  miniAppManifestSchema,
  type MiniAppManifest,
} from '@localixai/plugin-sdk/app-manifest'
import { summarizeZodIssues } from '@localixai/plugin-sdk/backend'
import { fromClaudePlugin } from './claude-code'

/**
 * THE seam between the two extension layers and the runtime (`docs/internals/plugins-and-mini-apps.md`).
 * A folder may hold a plugin (`.claude-plugin/plugin.json`), a mini app (`.localix-app/app.json`),
 * both, or a legacy root `plugin.json`; the loader, catalog and UI read the one runtime manifest
 * composed here. A later split into separate plugin and mini-app records cuts here.
 */

export type ExtensionLayout = 'plugin' | 'mini-app' | 'legacy'

/** A manifest file as read: its parsed JSON, or why it could not be read. */
export type ManifestFile = { file: string } & ({ json: unknown } | { readError: string })

export interface ManifestFiles {
  /** `.claude-plugin/plugin.json` */
  plugin?: ManifestFile
  /** `.localix-app/app.json` */
  app?: ManifestFile
  /** A root `plugin.json` written before the split (or by an earlier Claude Code import). */
  legacy?: ManifestFile
}

export interface ComposedManifest {
  layout: ExtensionLayout
  /** The runtime manifest, before the host schema parses it; null without one (see `error`). */
  raw: Record<string, unknown> | null
  /** What the two formats' own rules found: warnings load, errors name what did not. */
  issues: PluginIssue[]
  /** Why nothing loads, for the plugin's error line. */
  error?: string
}

const fail = (layout: ExtensionLayout, issues: PluginIssue[], error: string): ComposedManifest => ({
  layout,
  raw: null,
  issues,
  error,
})

export function composeManifest(files: ManifestFiles, folderName: string): ComposedManifest {
  if (!files.plugin && !files.app) {
    // No manifest at all: a plugin named after its folder, as in Claude Code.
    if (!files.legacy) return { layout: 'plugin', raw: null, issues: [] }
    if ('readError' in files.legacy) return fail('legacy', [], files.legacy.readError)
    const legacy = files.legacy.json
    return legacy && typeof legacy === 'object' && !Array.isArray(legacy)
      ? { layout: 'legacy', raw: { ...(legacy as Record<string, unknown>) }, issues: [] }
      : fail('legacy', [], 'Invalid plugin.json: the manifest is not a JSON object')
  }
  const issues: PluginIssue[] = []
  const layout: ExtensionLayout = files.app ? 'mini-app' : 'plugin'
  if (files.legacy && !isImportArtifact(files.legacy))
    issues.push({
      severity: 'warning',
      path: 'plugin.json',
      message: `plugin.json is ignored: this folder has ${files.app ? MINI_APP_MANIFEST_FILE : MANIFEST_FILE}`,
    })

  let plugin: Record<string, unknown> | null = null
  if (files.plugin) {
    if ('readError' in files.plugin) return fail(layout, issues, files.plugin.readError)
    const parsed = parseClaudePluginManifest(files.plugin.json, { fallbackName: folderName })
    issues.push(...parsed.issues.map((found) => at(MANIFEST_FILE, found)))
    if (!parsed.manifest) return fail(layout, issues, firstError(parsed.issues, MANIFEST_FILE))
    plugin = fromClaudePlugin(parsed.manifest, issues)
  }
  if (!files.app) return { layout, raw: plugin, issues }

  if ('readError' in files.app) return fail(layout, issues, files.app.readError)
  const parsedApp = miniAppManifestSchema.safeParse(files.app.json)
  if (!parsedApp.success)
    return fail(
      layout,
      issues,
      `Invalid ${MINI_APP_MANIFEST_FILE}: ${summarizeZodIssues(parsedApp.error).message}`,
    )
  const app = parsedApp.data
  if (plugin && plugin.name !== app.name)
    return fail(
      layout,
      issues,
      `${MINI_APP_MANIFEST_FILE} names "${app.name}" but its plugin is "${String(plugin.name)}": a mini app and its plugin share one name`,
    )
  return { layout, raw: withMiniApp(plugin ?? { name: app.name }, app), issues }
}

/** Display fields the mini app speaks for; the plugin keeps its version, as in Claude Code. */
const DISPLAY = [
  'displayName',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
] as const
/** What only Localix runs, carried as written; the host schema validates each. */
const LOCALIX = [
  'apiVersion',
  'private',
  'category',
  'surfaces',
  'defaultEnabled',
  'fileAssociations',
  'views',
  'promptSections',
  'contributions',
] as const

function withMiniApp(
  plugin: Record<string, unknown>,
  app: MiniAppManifest,
): Record<string, unknown> {
  // Written for Localix, not imported: the mini app's author gets the authoring nudges.
  const { origin: _origin, ...out }: Record<string, unknown> = { ...plugin }
  for (const field of DISPLAY) if (app[field] !== undefined) out[field] = app[field]
  for (const field of LOCALIX) if (app[field] !== undefined) out[field] = app[field]
  if (out.version === undefined && app.version !== undefined) out.version = app.version
  if (app.backend !== undefined) out.tools = app.backend
  // One settings form: a key both declare is the plugin's.
  if (app.config)
    out.config = { ...app.config, ...(plugin.config as Record<string, unknown> | undefined) }
  if (app.dependencies) {
    const listed = (plugin.dependencies as unknown[] | undefined) ?? []
    const names = new Set(listed.map(dependencyName))
    out.dependencies = [
      ...listed,
      ...app.dependencies.filter((dependency) => !names.has(dependencyName(dependency))),
    ]
  }
  if (app.commands) out.commandOptions = app.commands
  return out
}

const dependencyName = (dependency: unknown): string =>
  typeof dependency === 'string'
    ? dependency
    : String((dependency as { name?: unknown } | null)?.name ?? '')

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

function firstError(found: readonly PluginIssue[], file: string): string {
  const error = found.find((entry) => entry.severity === 'error')
  return `Invalid ${file}: ${error?.message ?? 'the manifest cannot load'}`
}
