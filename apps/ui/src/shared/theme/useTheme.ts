import { useSyncExternalStore } from 'react'
// Relative (not `@/`) imports: this hook is also consumed by apps/landing via the
// `@ui/*` alias, where `@/` resolves to landing/src and would not find these.
import { applyPlatformDataset, isDesktop } from '@localixai/kit/environment'
import { hasNativeWindowMaterial } from '@localixai/kit/environment'
import { tauriInvoke } from '../lib/tauri'
import { readNativeHeaderTint } from './nativeHeaderTint'
// Imported before the boot block below runs, so the transparency level is on <html> by the time
// that block samples --sidebar for the native header.
import { onWindowTransparencyApplied } from './windowTransparency'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import {
  applyThemeChangeInstantly,
  canRevealThemeChange,
  revealThemeChange,
  type ThemeChangeOrigin,
} from './themeReveal'

export type { ThemeChangeOrigin } from './themeReveal'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'sandbox_theme'
const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system']

/** Exact sRGB of --background per theme (index.css tokens; lib.rs Color(7,7,7)). */
const THEME_BACKGROUNDS: Record<ResolvedTheme, string> = {
  dark: '#070707',
  light: '#f8f8f8',
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && THEME_MODES.includes(value as ThemeMode)
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode
}

/**
 * Write a complete theme selection straight to `<html>` (data-theme + colorScheme + the inline
 * background the index.html anti-FOUC script painted — an inline style wins over CSS, so it must
 * track every flip — + the browser-chrome `theme-color` metas) WITHOUT touching React state or
 * localStorage.
 *
 * Returns the concrete appearance so callers can mirror it.
 */
export function applyThemeModeToDom(mode: ThemeMode): ResolvedTheme {
  const effective = resolveTheme(mode)
  const root = document.documentElement
  const chromeBackground = THEME_BACKGROUNDS[effective]
  root.dataset.theme = effective
  root.style.colorScheme = effective
  // Match overscroll/browser chrome to the selected palette, not merely to a
  // generic dark/light fallback. The fallback remains for partial overlays.
  //
  // Skipped where a native window material backs the window: an inline style beats the stylesheet,
  // so this fill would sit ON TOP of the NSVisualEffectView and hide it permanently. The stylesheet
  // rule that makes the root transparent there cannot win against this line, which is why the
  // decision has to be made here rather than in CSS.
  if (hasNativeWindowMaterial()) {
    root.style.removeProperty('background-color')
  } else {
    root.style.backgroundColor = chromeBackground
  }
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', chromeBackground))
  return effective
}

// ─── Module-level singleton ──────────────────────────────────────────────────
// Theme state is app-global: many components call useTheme() simultaneously
// (ChatPage, Settings, the sonner Toaster, …), so per-instance useState would
// desync them — a Settings change would leave the rail icon stale and a stale
// 'system' instance's media listener would clobber the explicit choice on an OS
// flip. One store + useSyncExternalStore keeps every instance live. Built on
// React's own primitive (no zustand) because apps/landing also consumes this
// hook and carries no zustand dependency.

interface ThemeSnapshot {
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
}

function readStoredMode(): ThemeMode {
  const stored = loadString(THEME_STORAGE_KEY)
  return isThemeMode(stored) ? stored : 'dark'
}

let currentMode: ThemeMode = typeof window === 'undefined' ? 'dark' : readStoredMode()
let currentResolved: ResolvedTheme =
  typeof window === 'undefined' ? 'dark' : resolveTheme(currentMode)
let snapshot: ThemeSnapshot = { themeMode: currentMode, resolvedTheme: currentResolved }

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ThemeSnapshot {
  return snapshot
}

type NativeThemePreference = ResolvedTheme | 'system'

/**
 * The desktop shell must keep a genuine System choice as `system`, not flatten it to whichever
 * colour the webview happened to report before the native override was released.
 */
export function resolveNativeThemePreference(
  mode: ThemeMode,
  resolved: ResolvedTheme,
): NativeThemePreference {
  return mode === 'system' ? 'system' : resolved
}

let currentNativePreference: NativeThemePreference | null = null
let currentNativeAppearance: ResolvedTheme | null = null

/** Desktop: sync native chrome without destroying a genuine System choice. */
function syncNativeTheme(mode: ThemeMode, resolved: ResolvedTheme) {
  if (!isDesktop) return
  const invoke = tauriInvoke()
  if (!invoke) return
  const preference = resolveNativeThemePreference(mode, resolved)
  if (preference === currentNativePreference && resolved === currentNativeAppearance) return
  currentNativePreference = preference
  currentNativeAppearance = resolved
  invoke('set_theme', {
    theme: preference,
    materialTheme: resolved,
    headerTint: readNativeHeaderTint(),
  })
    .then(() => {
      // Releasing a previous explicit native override updates
      // `prefers-color-scheme`. Re-sample after the shell has applied `system`;
      // the media listener remains the long-lived path for later OS changes.
      if (preference === 'system' && currentMode === 'system') onSystemChange()
    })
    .catch(() => {
      // Let a later commit retry if the bridge was temporarily unavailable.
      if (currentNativePreference === preference && currentNativeAppearance === resolved) {
        currentNativePreference = null
        currentNativeAppearance = null
      }
    })
}

/** Commit new state to the singleton + persist + notify every subscriber. */
function commit(mode: ThemeMode, resolved: ResolvedTheme) {
  const changed = mode !== currentMode || resolved !== currentResolved
  currentMode = mode
  currentResolved = resolved
  saveString(THEME_STORAGE_KEY, mode)
  updateSystemListener()
  syncNativeTheme(mode, resolved)
  if (changed) {
    snapshot = { themeMode: currentMode, resolvedTheme: currentResolved }
    listeners.forEach((l) => l())
  }
}

// The SINGLE system-theme listener, attached only while mode === 'system'.
// `matchMedia` is feature-detected, not assumed from `window` being defined: a
// non-browser host (SSR, a test runner with a stub window) has the global without the
// media API, and a hard call there throws at MODULE LOAD — taking the whole app down.
const systemMedia =
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia('(prefers-color-scheme: light)')
let systemListenerAttached = false

function onSystemChange() {
  if (currentMode !== 'system') return
  commit('system', applyThemeModeToDom('system'))
}

function updateSystemListener() {
  if (!systemMedia) return
  const want = currentMode === 'system'
  if (want && !systemListenerAttached) {
    systemMedia.addEventListener('change', onSystemChange)
    systemListenerAttached = true
  } else if (!want && systemListenerAttached) {
    systemMedia.removeEventListener('change', onSystemChange)
    systemListenerAttached = false
  }
}

// Boot: mirror the index.html anti-FOUC script through the full DOM writer
// (metas + inline background included) and sync the native chrome once.
if (typeof window !== 'undefined') {
  // This module boots while main.tsx's imports are still evaluating. Resolve native
  // material selectors before sampling --sidebar, or AppKit receives the browser
  // coat (45% in dark mode) while the mounted UI later switches to the macOS coat (70%).
  applyPlatformDataset()
  currentResolved = applyThemeModeToDom(currentMode)
  snapshot = { themeMode: currentMode, resolvedTheme: currentResolved }
  updateSystemListener()
  syncNativeTheme(currentMode, currentResolved)
  // A new transparency level changes --sidebar, which the native header is tinted from, while the
  // theme stays the same — so forget the last sync instead of letting it dedupe this one away.
  onWindowTransparencyApplied(() => {
    currentNativePreference = null
    syncNativeTheme(currentMode, currentResolved)
  })
  // Each webview has its own JS store. Mirror the persisted selection so an older webview
  // cannot put AppKit back in dark mode after another switches to light.
  const onStoredTheme = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    const mode = readStoredMode()
    commit(mode, applyThemeModeToDom(mode))
  }
  window.addEventListener('storage', onStoredTheme)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', onStoredTheme))
}

/** Change the theme mode (optionally with a circular reveal from `origin`). */
function setThemeMode(mode: ThemeMode, origin?: ThemeChangeOrigin) {
  const apply = () => commit(mode, applyThemeModeToDom(mode))
  if (origin && canRevealThemeChange(origin)) revealThemeChange(origin, apply)
  else applyThemeChangeInstantly(apply)
}

/**
 * The next mode in the cycle: dark → light → system → dark.
 *
 * Ordered so the two concrete choices come first and `system` last: a user who wants to see the
 * other appearance gets there in one press, and the third press hands control back to the OS.
 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode)
  return THEME_MODES[(index + 1) % THEME_MODES.length] ?? 'dark'
}

/** Advance the cycle, with the same optional reveal `setThemeMode` takes. */
export function cycleThemeMode(origin?: ThemeChangeOrigin): ThemeMode {
  const next = nextThemeMode(currentMode)
  setThemeMode(next, origin)
  return next
}

export function useTheme() {
  const { themeMode, resolvedTheme } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { themeMode, resolvedTheme, setThemeMode, cycleThemeMode }
}
