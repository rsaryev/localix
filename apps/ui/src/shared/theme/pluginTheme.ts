import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { pluginContribSnapshot, subscribePluginContrib } from '@/shared/contrib/enabledPlugins'

/**
 * A plugin's color theme (Claude Code `themes/<slug>.json`) laid over the appearance it starts
 * from. The server maps the theme's tokens to kit CSS properties (`plugins/themes.ts`); this
 * module paints them as inline custom properties on `<html>`, which win over both theme sheets.
 *
 * Device-local, like the appearance: the choice is kept beside `sandbox_theme`, which holds the
 * theme's base so the boot script paints the right ground before this runs. The overrides apply
 * only while the window shows that base — cycling to the other appearance shows it plain, and
 * cycling back restores the theme.
 *
 * The themes on offer are the open scope's: the global plugins' and the open project's own
 * (`listThemesFromCatalog`). A chosen theme the scope does not list — its plugin disabled, or a
 * project plugin's theme while another project is open — shows its base, and the choice is kept,
 * as Claude Code keeps `custom:<slug>`: it paints again wherever it is listed. Until the scope's
 * document arrives the stored theme paints, so a reload does not flash the plain base.
 */
export type PluginThemeSpec = CapabilitySnapshot['themes'][number]

const STORAGE_KEY = 'sandbox_plugin_theme'
const NO_THEMES: readonly PluginThemeSpec[] = []

function readStored(): PluginThemeSpec | null {
  try {
    const parsed = JSON.parse(loadString(STORAGE_KEY) ?? 'null') as PluginThemeSpec | null
    return parsed && typeof parsed.id === 'string' && parsed.overrides ? parsed : null
  } catch {
    return null
  }
}

let current: PluginThemeSpec | null = typeof window === 'undefined' ? null : readStored()
/** The open scope's themes; undefined until its capability document is known. */
let listed: readonly PluginThemeSpec[] | undefined
let painted: string[] = []
const listeners = new Set<() => void>()

/** Paint `theme`'s overrides on `root` when it shows the theme's base; clear the previous ones. */
export function paintPluginTheme(root: HTMLElement, theme: PluginThemeSpec | null): void {
  for (const property of painted) root.style.removeProperty(property)
  painted = []
  if (!theme || root.dataset.theme !== theme.base) return
  for (const [property, color] of Object.entries(theme.overrides)) {
    if (!property.startsWith('--')) continue
    root.style.setProperty(property, color)
    painted.push(property)
  }
}

/** The chosen theme when the open scope offers it (or is not known yet), else null. */
function shown(): PluginThemeSpec | null {
  if (!current) return null
  if (!listed) return current
  return listed.some((theme) => theme.id === current?.id) ? current : null
}

function repaint(): void {
  paintPluginTheme(document.documentElement, shown())
  listeners.forEach((listener) => listener())
}

function commit(theme: PluginThemeSpec | null): void {
  current = theme
  saveString(STORAGE_KEY, theme ? JSON.stringify(theme) : null)
  repaint()
}

/** Choose a plugin theme. The caller switches the appearance to `theme.base` first. */
export function choosePluginTheme(theme: PluginThemeSpec): void {
  commit(theme)
}

/** Back to the plain appearance (a System, Light or Dark choice). */
export function clearPluginTheme(): void {
  if (current) commit(null)
}

/**
 * Follow the open scope's themes: an updated plugin repaints its theme, and one the scope does not
 * list steps aside without being forgotten. `undefined` (no document for this scope yet) shows the
 * stored choice until the scope is known.
 */
export function reconcilePluginTheme(themes: readonly PluginThemeSpec[] | undefined): void {
  listed = themes
  const fresh = current && themes?.find((theme) => theme.id === current?.id)
  if (fresh && JSON.stringify(fresh) !== JSON.stringify(current)) commit(fresh)
  else repaint()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The chosen plugin theme, or null — kept while the open scope does not list it. */
export function usePluginTheme(): PluginThemeSpec | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}

/** The chosen plugin theme outside React (`/theme`). */
export function currentPluginTheme(): PluginThemeSpec | null {
  return current
}

/** The themes the open scope offers: its global and project plugins'. */
export function scopeThemes(): readonly PluginThemeSpec[] {
  return pluginContribSnapshot().document?.themes ?? NO_THEMES
}

/** {@link scopeThemes} as a hook, following the workbench's scope. */
export function useScopeThemes(): readonly PluginThemeSpec[] {
  return useSyncExternalStore(subscribePluginContrib, scopeThemes, () => NO_THEMES)
}

/**
 * Paint the stored theme before first paint, and keep it in step with the appearance (another
 * writer flips `data-theme`), other windows (the storage event) and the open scope's plugins.
 */
export function installPluginTheme(): () => void {
  const root = document.documentElement
  paintPluginTheme(root, shown())
  const observer = new MutationObserver(() => paintPluginTheme(root, shown()))
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    current = readStored()
    repaint()
  }
  window.addEventListener('storage', onStorage)
  const stopContrib = subscribePluginContrib(() =>
    reconcilePluginTheme(pluginContribSnapshot().document?.themes),
  )
  return () => {
    observer.disconnect()
    window.removeEventListener('storage', onStorage)
    stopContrib()
  }
}
