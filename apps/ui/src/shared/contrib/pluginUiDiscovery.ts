import type { PluginRecord } from '@/shared/api/contracts'
import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { announcePluginUiChanged } from './enabledPlugins'
import { dropHostDuplicates, hostRuleTexts } from './pluginStyleDedupe'
import { pluginUiHostFor, removePluginUiContributions } from './host'
import { setPluginSources, type PluginUiSource } from './pluginAttribution'
import {
  PLUGIN_UI_PRELOADED_MODULES,
  PLUGIN_UI_SHARED_GLOBAL,
  type PluginUiSharedModules,
} from '@localixai/plugin-sdk/ui-artifact'
import {
  createPluginUiRuntime,
  type PluginUiArtifact,
  type PluginUiFailureReporter,
} from './pluginUiRuntime'

/**
 * The workbench's ONE plugin UI runtime, wired to the host: artifacts come from the capability
 * snapshot, are imported by URL from the API, register through the ownership-stamping façade and
 * are taken back by owner. Loaded lazily by `enabledPlugins.ts`, only once a snapshot names
 * enabled plugins, so no plugin code or loader metadata sits on first paint.
 *
 * Nothing here knows about development or about who built a plugin: a UI edit becomes a new
 * artifact revision (staged for a first-party plugin, built by the API for a user plugin), the API
 * announces it, the next snapshot carries it, and the runtime replaces that plugin — the same path
 * a release takes.
 */

const warnPluginUiFailure: PluginUiFailureReporter = (pluginName, error) => {
  console.warn(
    `[plugin-ui] "${pluginName}" could not load its UI; the running version (if any) stays`,
    error,
  )
}

/** An artifact URL at one revision, against the API origin the rest of the client uses. */
function artifactUrl(path: string, revision: string): string {
  const url = new URL(path, API_BASE_URL || window.location.origin)
  url.searchParams.set('v', revision)
  return url.href
}

/**
 * Attach one plugin's sheets and resolve when they applied (or failed: a sheet is not fatal).
 *
 * The Tailwind utilities sheet is fetched and adopted with the host's duplicates removed (see
 * `pluginStyleDedupe`), so a plugin cannot out-rank the host on the host's own elements. A `<link>`
 * cannot do that: on the desktop the artifact comes from the API's origin, and a cross-origin
 * sheet's rules cannot be read or edited. Only that sheet: an adopted sheet resolves `url()`
 * against the document rather than the artifact, which a component's own CSS (fonts, images) may
 * rely on, and only the utilities duplicate the host. Where adoption is unavailable or the fetch
 * fails, the sheet falls back to a plain link — the plugin still renders with its old precedence.
 */
async function mountStyles(artifact: PluginUiArtifact): Promise<() => void> {
  const utilities = artifact.styles.filter(isUtilitiesSheet)
  const own = artifact.styles.filter((style) => !isUtilitiesSheet(style))
  const unmounts = await Promise.all([
    linkStyles(artifact, own),
    ...utilities.map((style) => adoptDeduplicated(artifact, style)),
  ])
  return () => unmounts.forEach((unmount) => unmount())
}

/**
 * The sheet `ui-build.ts` writes the plugin's host-themed Tailwind utilities to. The snapshot
 * carries it as the full path the API serves it at, so it is matched by its file name.
 */
const isUtilitiesSheet = (style: string) => style.split(/[?#]/u)[0].endsWith('/utilities.css')

async function adoptDeduplicated(artifact: PluginUiArtifact, style: string): Promise<() => void> {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) {
    return linkStyles(artifact, [style])
  }
  try {
    const response = await apiFetch(artifactUrl(style, artifact.revision))
    if (!response.ok) throw new Error(`${style}: HTTP ${response.status}`)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(await response.text())
    dropHostDuplicates(sheet, hostRuleTexts(Array.from(document.styleSheets)))
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet)
    }
  } catch {
    return linkStyles(artifact, [style])
  }
}

function linkStyles(artifact: PluginUiArtifact, styles: readonly string[]): Promise<() => void> {
  const links = styles.map((style) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = artifactUrl(style, artifact.revision)
    link.dataset.plugin = artifact.name
    return link
  })
  const applied = links.map(
    (link) =>
      new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true })
        link.addEventListener('error', () => resolve(), { once: true })
      }),
  )
  document.head.append(...links)
  return Promise.all(applied).then(() => () => links.forEach((link) => link.remove()))
}

/**
 * The host's shared modules, which the app layer installs at boot (`app/pluginSharedModules.ts`),
 * loaded far enough that an artifact can read the preloaded ones synchronously. Read through the
 * SDK contract, so this layer never imports the kit the app composes.
 */
async function sharedModulesReady(): Promise<void> {
  const scope = globalThis as unknown as Record<string, PluginUiSharedModules | undefined>
  const shared = scope[PLUGIN_UI_SHARED_GLOBAL]
  if (!shared) throw new Error('[plugin-ui] the host installed no shared modules for plugin UI')
  await Promise.all(PLUGIN_UI_PRELOADED_MODULES.map((specifier) => shared.load(specifier)))
}

let runtime: ReturnType<typeof createPluginUiRuntime> | undefined

function pluginUiRuntime() {
  if (runtime) return runtime
  // Awaited before the first artifact import (a CommonJS dependency that `require`s React finds
  // it loaded) and only then: a snapshot with no artifacts costs nothing.
  let ready: Promise<void> | undefined
  runtime = createPluginUiRuntime({
    importEntry: async (artifact) => {
      // A failed preload (a chunk error) must not fail every later import: retry next time.
      ready ??= sharedModulesReady().catch((error: unknown) => {
        ready = undefined
        throw error
      })
      await ready
      return import(/* @vite-ignore */ artifactUrl(artifact.entry, artifact.revision))
    },
    mountStyles,
    hostFor: pluginUiHostFor,
    remove: removePluginUiContributions,
    announce: announcePluginUiChanged,
    report: warnPluginUiFailure,
  })
  return runtime
}

/** The enabled plugins that ship a UI artifact, as the runtime's input. */
export function pluginUiArtifacts(plugins: readonly PluginRecord[]): PluginUiArtifact[] {
  return plugins.flatMap((plugin) =>
    plugin.enabled && plugin.ui ? [{ name: plugin.name, ...plugin.ui }] : [],
  )
}

/**
 * What attribution needs to name a plugin from a stack frame: every installed plugin's display
 * name, and the directory each loaded artifact is imported from. The directory is resolved from
 * the SAME URL `importEntry` imports, so the frames of the entry and of every chunk it loads
 * relative to itself lie under it; resolving `.` also drops the revision query, which a chunk's
 * URL does not carry.
 */
export function pluginSources(plugins: readonly PluginRecord[]): {
  sources: PluginUiSource[]
  names: Map<string, string>
} {
  return {
    sources: pluginUiArtifacts(plugins).map((artifact) => ({
      pluginName: artifact.name,
      base: new URL('.', artifactUrl(artifact.entry, artifact.revision)).href,
    })),
    names: new Map(plugins.map((plugin) => [plugin.name, plugin.displayName || plugin.name])),
  }
}

/** Converge the workbench on the UI of exactly these (enabled) plugins; see `reconcile`. */
export const discoverEnabledPluginUi = (
  plugins: readonly PluginRecord[],
  settled?: (pluginName: string, ok: boolean) => void,
): Promise<void> => {
  const { sources, names } = pluginSources(plugins)
  setPluginSources(sources, names)
  return pluginUiRuntime().reconcile(pluginUiArtifacts(plugins), settled)
}
