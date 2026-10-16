import { isDesktop } from '@localixai/kit/environment'

/** The address of the browser's own history list, a tab with no page behind it. */
export const BROWSER_HISTORY_URL = 'browser://history'

/** A loopback address: a page served from this machine, usually a dev server. */
export function isLocalBrowserUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * A page the in-app frame can host: a local page that allows framing. Only there does the proxy
 * inject the Visual Feedback probe and relay the dev server's HMR, which is why these pages stay
 * in the frame even on the desktop.
 */
export function hostsInFrame(tab: { url: string; frameBlocked?: boolean }): boolean {
  return isLocalBrowserUrl(tab.url) && !tab.frameBlocked
}

export type BrowserEngine = 'history' | 'native' | 'frame'

/** Every desktop shell hosts native pages; Linux through a `gtk::Fixed` (`native_browser_gtk.rs`). */
const NATIVE_PAGES = isDesktop

interface EngineInput {
  url: string
  frameBlocked?: boolean
  nativePage?: boolean
}

/**
 * Which engine renders a browser tab: the history list, a native platform WebView, or the
 * in-app frame.
 *
 * The one rule every consumer asks — the workspace that renders the tab, the menu that reloads
 * it, the agent host that drives it, the background host that keeps it alive. Each used to spell
 * the rule out itself, and the copies had already drifted: the history pseudo-tab counted as a
 * native page for the agent host, whose `browser_open` then refused its `browser://` address.
 * Outside the desktop shell there is no native engine, so every page is framed.
 *
 * `desktop` means "the shell can host a native page".
 */
export function browserEngine(tab: EngineInput, desktop: boolean = NATIVE_PAGES): BrowserEngine {
  if (tab.url === BROWSER_HISTORY_URL) return 'history'
  return desktop && (tab.nativePage === true || !hostsInFrame(tab)) ? 'native' : 'frame'
}

/**
 * Where an address typed into a tab goes: into that tab, or to the engine that owns it.
 *
 * A tab keeps its engine. An address the tab's engine serves loads in place — the native page
 * navigates and keeps its history, a dev preview re-resolves its server. Any other address opens
 * where a fresh tab for it would: a local address as a dev preview with Visual Feedback, any
 * other as a native page. Without this, one address bar navigated in place while another asked
 * the server to fetch a stranger's site, and a native page typed onto localhost silently
 * swapped engines under a page that had already loaded.
 */
export function addressDestination(
  tab: EngineInput,
  url: string,
  desktop: boolean = NATIVE_PAGES,
): 'here' | 'elsewhere' {
  return browserEngine({ url }, desktop) === browserEngine(tab, desktop) ? 'here' : 'elsewhere'
}
