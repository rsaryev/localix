import { isDesktop } from './desktop'

/** OS family — drives native-feel UI (chrome, scrollbars, fonts, key hints). */
export type OsFamily = 'mac' | 'windows' | 'linux' | 'unknown'

/** Pure classifier shared by runtime detection and cross-platform contract tests. */
export function classifyOsFamily(platformText: string): OsFamily {
  const hay = platformText.toLowerCase()
  if (/mac|iphone|ipad/u.test(hay)) return 'mac'
  if (hay.includes('win')) return 'windows'
  if (hay.includes('linux') || hay.includes('x11') || hay.includes('cros')) return 'linux'
  return 'unknown'
}

function detectOsFamily(): OsFamily {
  if (typeof navigator === 'undefined') return 'unknown'
  // userAgentData.platform is the modern, UA-freeze-safe source; fall back to the
  // legacy strings. The classifier owns normalization and platform precedence.
  const uaPlatform = (navigator as unknown as { userAgentData?: { platform?: string } })
    .userAgentData?.platform
  return classifyOsFamily(
    `${uaPlatform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`,
  )
}

/** The detected OS family (computed once). */
export const OS_FAMILY: OsFamily = detectOsFamily()
/** Shared platform predicate for titlebar layout and shortcut semantics. */
export const IS_MAC = OS_FAMILY === 'mac'

/**
 * What this OS calls "show me where this file lives", named the way the OS names it.
 *
 * A file manager is one of the few places an app cannot stay platform-neutral without sounding
 * wrong: "Reveal in file manager" is nobody's phrasing. There are three strings here, one per
 * platform, for that reason: the menu item is a handoff to the desktop, and it should read like
 * the desktop's own.
 */
export const REVEAL_IN_OS_LABEL: string =
  OS_FAMILY === 'mac'
    ? 'Reveal in Finder'
    : OS_FAMILY === 'windows'
      ? 'Reveal in File Explorer'
      : 'Open containing folder'

/**
 * True where a NATIVE window material backs the window instead of a painted colour.
 *
 * Today that is the macOS desktop window: it is built transparent with an `UnderWindowBackground`
 * NSVisualEffectView behind it. The predicate exists because two places set an inline background on
 * `<html>` — the anti-FOUC script and `applyThemeModeToDom` — and an inline style beats the
 * stylesheet, so a fill there would cover the material permanently. Any code that paints the
 * window's own ground has to ask this first.
 *
 * Derived from the platform rather than reported by the shell, which is the honest limit of this
 * step: if `apply_vibrancy` ever fails, Rust logs it and the window is transparent with nothing
 * behind it. Making the shell state the answer is the next step, not this one.
 */
export function hasNativeWindowMaterial(): boolean {
  return isDesktop && IS_MAC
}

/**
 * Stamp `data-os` + `data-desktop` on `<html>` so CSS can key native-feel styles
 * off the platform (native scrollbars, font stacks, chrome) without JS in every
 * component. Idempotent — safe to call once at startup. Mirrors how the theme
 * writes `data-theme` on the same element.
 */
export function applyPlatformDataset(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.os = OS_FAMILY
  root.dataset.desktop = String(isDesktop)
}
