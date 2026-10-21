import { PLUGIN_NAME_RE } from '@localixai/plugin-sdk/manifest'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

/** A manifest's plugin name, bounded as the shell bounds it (`app_bundle::valid_plugin`). */
const validPluginName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 64 && PLUGIN_NAME_RE.test(name)

/**
 * A plugin installed as its own Mac app (`apps/desktop-tauri/src-tauri/src/app_runner.rs`).
 *
 * The app's window loads this same UI against the running Localix, with `__LOCALIX_APP` set
 * before any of it runs. The page then shows that plugin in its own conversation and nothing of
 * the workspace frame; everything else (sessions, the agent, the plugin runtime) is the ordinary
 * client. The window is a native one the page talks to through `localixApp` messages.
 */
export interface PluginAppContext {
  plugin: string
  name: string
  /** The app's own project folder (`~/.localix/apps/<plugin>`); its conversations live there. */
  projectDir: string
}

export type PluginAppMessage =
  | { type: 'badge'; text: string | null }
  | { type: 'theme'; dark: boolean }
  | { type: 'session'; id: string | null }

declare global {
  interface Window {
    __LOCALIX_APP?: PluginAppContext
    webkit?: { messageHandlers?: { localixApp?: { postMessage(body: string): void } } }
  }
}

export function pluginApp(): PluginAppContext | null {
  if (typeof window === 'undefined') return null
  const app = window.__LOCALIX_APP
  if (!app || !validPluginName(app.plugin)) return null
  if (typeof app.projectDir !== 'string' || !app.projectDir) return null
  return {
    plugin: app.plugin,
    name: typeof app.name === 'string' ? app.name : app.plugin,
    projectDir: app.projectDir,
  }
}

/** Tell the app's native window something; a no-op anywhere else. */
export function postToPluginApp(message: PluginAppMessage): void {
  try {
    window.webkit?.messageHandlers?.localixApp?.postMessage(JSON.stringify(message))
  } catch {
    // The window is going away; nothing to tell.
  }
}

/** The backend record of which conversation the app shows, shared with every client. */
export function pluginAppViewState(plugin: string) {
  return { kind: 'surface', key: `plugin-app:${plugin}` } as const
}

const sessionKey = (plugin: string) => `localix_plugin_app_session:${plugin}`

/** The local copy of the app's conversation, read before the backend answers. */
export function rememberedPluginAppSession(plugin: string): string | null {
  return loadString(sessionKey(plugin))
}

export function rememberPluginAppSession(plugin: string, sessionId: string | null): void {
  saveString(sessionKey(plugin), sessionId)
}

/**
 * Draw like the macOS workspace. The app's window backs the page with the same native glass, and
 * the kit keys its transparent root, coats and system font off `data-desktop` + `data-os`. Only
 * the stylesheet is told: the JavaScript `isDesktop` stays false, because there is no shell to
 * invoke in this window.
 */
export function stampPluginAppDataset(): void {
  if (!pluginApp()) return
  const root = document.documentElement
  root.dataset.desktop = 'true'
  root.dataset.pluginApp = 'true'
}

/**
 * Start the router on the app's own conversation. Without this the first route is the home page,
 * which would mint an empty draft before the app could navigate to its conversation.
 */
export function applyPluginAppStartRoute(): void {
  const app = pluginApp()
  if (!app || window.location.hash.length > 1) return
  const sessionId = rememberedPluginAppSession(app.plugin)
  if (sessionId) window.location.hash = `#/chat/${encodeURIComponent(sessionId)}`
}
