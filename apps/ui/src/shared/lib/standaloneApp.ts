import { MINI_APP_NAME_RE } from '@localixai/mini-app-sdk/manifest'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

/** A manifest's mini app name, bounded as the shell bounds it (`app_bundle::valid_mini_app`). */
const validMiniAppName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 64 && MINI_APP_NAME_RE.test(name)

/**
 * A mini app installed as its own Mac app (`apps/desktop-tauri/src-tauri/src/app_runner.rs`).
 *
 * The app's window loads this same UI against the running Localix, with `__LOCALIX_APP` set
 * before any of it runs. The page then shows that mini app in its own conversation and nothing of
 * the workspace frame; everything else (sessions, the agent, the mini app runtime) is the ordinary
 * client. The window is a native one the page talks to through `localixApp` messages.
 */
export interface StandaloneAppContext {
  miniApp: string
  name: string
  /** The app's own project folder (`~/.localix/apps/<app>`); its conversations live there. */
  projectDir: string
}

export type StandaloneAppMessage =
  | { type: 'badge'; text: string | null }
  | { type: 'theme'; dark: boolean }
  | { type: 'session'; id: string | null }

declare global {
  interface Window {
    __LOCALIX_APP?: StandaloneAppContext
    webkit?: { messageHandlers?: { localixApp?: { postMessage(body: string): void } } }
  }
}

export function standaloneApp(): StandaloneAppContext | null {
  if (typeof window === 'undefined') return null
  const app = window.__LOCALIX_APP
  if (!app || !validMiniAppName(app.miniApp)) return null
  if (typeof app.projectDir !== 'string' || !app.projectDir) return null
  return {
    miniApp: app.miniApp,
    name: typeof app.name === 'string' ? app.name : app.miniApp,
    projectDir: app.projectDir,
  }
}

/** Tell the app's native window something; a no-op anywhere else. */
export function postToStandaloneApp(message: StandaloneAppMessage): void {
  try {
    window.webkit?.messageHandlers?.localixApp?.postMessage(JSON.stringify(message))
  } catch {
    // The window is going away; nothing to tell.
  }
}

/** The backend record of which conversation the app shows, shared with every client. */
export function standaloneAppViewState(miniApp: string) {
  return { kind: 'surface', key: `standalone-app:${miniApp}` } as const
}

const sessionKey = (miniApp: string) => `localix_standalone_app_session:${miniApp}`

/** The local copy of the app's conversation, read before the backend answers. */
export function rememberedStandaloneAppSession(miniApp: string): string | null {
  return loadString(sessionKey(miniApp))
}

export function rememberStandaloneAppSession(miniApp: string, sessionId: string | null): void {
  saveString(sessionKey(miniApp), sessionId)
}

/**
 * Draw like the macOS workspace. The app's window backs the page with the same native glass, and
 * the kit keys its transparent root, coats and system font off `data-desktop` + `data-os`. Only
 * the stylesheet is told: the JavaScript `isDesktop` stays false, because there is no shell to
 * invoke in this window.
 */
export function stampStandaloneAppDataset(): void {
  if (!standaloneApp()) return
  const root = document.documentElement
  root.dataset.desktop = 'true'
  root.dataset.standaloneApp = 'true'
}

/**
 * Start the router on the app's own conversation. Without this the first route is the home page,
 * which would mint an empty draft before the app could navigate to its conversation.
 */
export function applyStandaloneAppStartRoute(): void {
  const app = standaloneApp()
  if (!app || window.location.hash.length > 1) return
  const sessionId = rememberedStandaloneAppSession(app.miniApp)
  if (sessionId) window.location.hash = `#/chat/${encodeURIComponent(sessionId)}`
}
