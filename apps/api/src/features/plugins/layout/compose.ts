import {
  MANIFEST_FILE,
  parseClaudePluginManifest,
  type PluginIssue,
} from '@localixai/claude-plugin'
import {
  LEGACY_MINI_APP_MANIFEST_FILE,
  MINI_APP_MANIFEST_FILE,
  legacyMiniAppManifestSchema,
  miniAppManifestSchema,
  type LegacyMiniAppManifest,
  type MiniAppManifest,
} from '@localixai/mini-app-sdk/app-manifest'
import { summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import { fromClaudePlugin } from './claude-code'

/**
 * THE seam between the two extension layers and the runtime (`docs/internals/plugins-and-mini-apps.md`).
 * A folder holds a plugin (`.claude-plugin/plugin.json`) or a mini app (`mini-app.json`), never
 * both (rule X2). Until the mini app runtime is its own feature, both are read into the one runtime
 * manifest composed here; so are the two layouts written before the split: a plugin decorated by
 * `.localix-app/app.json`, and a legacy root `plugin.json`.
 */

export type ExtensionLayout = 'plugin' | 'mini-app' | 'decorated' | 'legacy'

/** A manifest file as read: its parsed JSON, or why it could not be read. */
export type ManifestFile = { file: string } & ({ json: unknown } | { readError: string })

export interface ManifestFiles {
  /** `mini-app.json` */
  miniApp?: ManifestFile
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
  if (files.miniApp) return composeMiniApp(files)
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
  const layout: ExtensionLayout = files.app ? 'decorated' : 'plugin'
  if (files.legacy && !isImportArtifact(files.legacy))
    issues.push({
      severity: 'warning',
      path: 'plugin.json',
      message: `plugin.json is ignored: this folder has ${files.app ? LEGACY_MINI_APP_MANIFEST_FILE : MANIFEST_FILE}`,
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
  const parsedApp = legacyMiniAppManifestSchema.safeParse(files.app.json)
  if (!parsedApp.success)
    return fail(
      layout,
      issues,
      `Invalid ${LEGACY_MINI_APP_MANIFEST_FILE}: ${summarizeZodIssues(parsedApp.error).message}`,
    )
  const app = parsedApp.data
  if (plugin && plugin.name !== app.name)
    return fail(
      layout,
      issues,
      `${LEGACY_MINI_APP_MANIFEST_FILE} names "${app.name}" but its plugin is "${String(plugin.name)}": a mini app and its plugin share one name`,
    )
  return { layout, raw: withMiniApp(plugin ?? { name: app.name }, app), issues }
}

/** A mini app is its own manifest; a plugin or an older manifest beside it loads nothing (X2). */
function composeMiniApp(files: ManifestFiles): ComposedManifest {
  const file = files.miniApp!
  const beside = [files.plugin, files.app, files.legacy].find((other) => other !== undefined)
  if (beside)
    return fail(
      'mini-app',
      [],
      `${MINI_APP_MANIFEST_FILE} and ${beside.file} are both here: a folder is a mini app or a plugin, not both`,
    )
  if ('readError' in file) return fail('mini-app', [], file.readError)
  const parsed = miniAppManifestSchema.safeParse(file.json)
  if (!parsed.success)
    return fail(
      'mini-app',
      [],
      `Invalid ${MINI_APP_MANIFEST_FILE}: ${summarizeZodIssues(parsed.error).message}`,
    )
  return { layout: 'mini-app', raw: fromMiniApp(parsed.data), issues: [] }
}

/** The runtime manifest of a mini app: its backend is `tools`, its commands carry their prompts. */
function fromMiniApp(app: MiniAppManifest): Record<string, unknown> {
  const { backend, commands, ...rest } = app
  return {
    ...rest,
    ...(backend !== undefined ? { tools: backend } : {}),
    ...(commands
      ? { commands: Object.entries(commands).map(([name, command]) => ({ name, ...command })) }
      : {}),
  }
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
  app: LegacyMiniAppManifest,
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
    : typeof (dependency as { name?: unknown } | null)?.name === 'string'
      ? (dependency as { name: string }).name
      : ''

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
